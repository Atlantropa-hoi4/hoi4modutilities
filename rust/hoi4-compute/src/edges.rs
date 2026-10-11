//! Exact provincebmp.ts flood-fill, directed path reduction, and X crossings.

use crate::{
    pixel_bytes, validate_input_length, write_header, zeroed_bytes, ComputeError, MAX_OUTPUT_BYTES,
    RESULT_HEADER_BYTES,
};
use std::mem::size_of;

// All temporary vector capacities, including the growing serialization, share
// this budget. Reallocation accounts for both old and new buffers at its peak.
// The final exact-sized result is separately bounded by MAX_OUTPUT_BYTES.
const MAX_SCRATCH_BYTES: usize = 256 * 1024 * 1024;
const NONE: u32 = u32::MAX;
const EMPTY_KEY: u64 = u64::MAX;
const PAYLOAD_HEADER_BYTES: usize = 16;

#[derive(Clone, Copy)]
pub(crate) struct EdgesLayout {
    width: usize,
    height: usize,
    input_bytes: usize,
}

impl EdgesLayout {
    pub(crate) fn new(input_len: usize, width: u32, height: u32) -> Result<Self, ComputeError> {
        validate_input_length(input_len)?;
        let input_bytes = pixel_bytes(width, height)?;
        validate_input_length(input_bytes)?;
        if input_len < input_bytes {
            return Err(ComputeError::TruncatedInput);
        }
        Ok(Self {
            width: width as usize,
            height: height as usize,
            input_bytes,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Point {
    x: u32,
    y: u32,
}

impl Point {
    fn key(self) -> u64 {
        (u64::from(self.x) << 32) | u64::from(self.y)
    }
}

#[derive(Clone, Copy, Debug)]
struct Boundary {
    to_color: u32,
    order: u32,
    start: Point,
    end: Point,
}

struct Scratch {
    used: usize,
    limit: usize,
}

impl Scratch {
    fn reserve<T>(&mut self, values: &mut Vec<T>, length: usize) -> Result<(), ComputeError> {
        if length <= values.capacity() {
            return Ok(());
        }
        let available = self
            .limit
            .checked_sub(self.used)
            .ok_or(ComputeError::SizeLimitExceeded)?
            / size_of::<T>();
        if length > available {
            return Err(ComputeError::SizeLimitExceeded);
        }
        let capacity = values
            .capacity()
            .checked_mul(2)
            .unwrap_or(available)
            .max(8)
            .max(length)
            .min(available);
        let old_bytes = values
            .capacity()
            .checked_mul(size_of::<T>())
            .ok_or(ComputeError::SizeLimitExceeded)?;
        values
            .try_reserve_exact(capacity - values.len())
            .map_err(|_| ComputeError::AllocationFailed)?;
        let new_bytes = values
            .capacity()
            .checked_mul(size_of::<T>())
            .ok_or(ComputeError::SizeLimitExceeded)?;
        let peak = self
            .used
            .checked_add(new_bytes)
            .ok_or(ComputeError::SizeLimitExceeded)?;
        self.used = peak - old_bytes;
        if peak > self.limit {
            return Err(ComputeError::SizeLimitExceeded);
        }
        Ok(())
    }

    fn push<T>(&mut self, values: &mut Vec<T>, value: T) -> Result<(), ComputeError> {
        let length = values
            .len()
            .checked_add(1)
            .ok_or(ComputeError::SizeLimitExceeded)?;
        self.reserve(values, length)?;
        values.push(value);
        Ok(())
    }

    fn resize<T: Copy>(
        &mut self,
        values: &mut Vec<T>,
        length: usize,
        value: T,
    ) -> Result<(), ComputeError> {
        self.reserve(values, length)?;
        values.resize(length, value);
        Ok(())
    }

    fn release<T>(&mut self, values: &mut Vec<T>) {
        // Only capacities previously charged by reserve can reach this call.
        self.used -= values.capacity() * size_of::<T>();
        *values = Vec::new();
    }
}

struct Output {
    bytes: Vec<u8>,
    limit: usize,
}

impl Output {
    fn new(scratch: &mut Scratch) -> Result<Self, ComputeError> {
        let mut bytes = Vec::new();
        scratch.resize(&mut bytes, RESULT_HEADER_BYTES + PAYLOAD_HEADER_BYTES, 0)?;
        let mut output = Self {
            bytes,
            limit: MAX_OUTPUT_BYTES,
        };
        output.word(RESULT_HEADER_BYTES, 1);
        Ok(output)
    }

    fn append(&mut self, scratch: &mut Scratch, words: &[u32]) -> Result<usize, ComputeError> {
        let offset = self.bytes.len();
        let length = words
            .len()
            .checked_mul(4)
            .and_then(|bytes| offset.checked_add(bytes))
            .filter(|&bytes| bytes <= self.limit)
            .ok_or(ComputeError::SizeLimitExceeded)?;
        scratch.reserve(&mut self.bytes, length)?;
        for word in words {
            self.bytes.extend_from_slice(&word.to_le_bytes());
        }
        Ok(offset)
    }

    fn word(&mut self, offset: usize, value: u32) {
        self.bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }

    fn finish(self) -> Result<Box<[u8]>, ComputeError> {
        // Do not box the overallocated growth buffer: create the exact-sized
        // allocation fallibly first, so boxing does not need to shrink it.
        let mut result = zeroed_bytes(self.bytes.len())?;
        result.copy_from_slice(&self.bytes);
        let payload_bytes = result.len() - RESULT_HEADER_BYTES;
        write_header(&mut result, payload_bytes, 0);
        Ok(result.into_boxed_slice())
    }
}

#[derive(Clone, Copy)]
struct EndpointSlot {
    key: u64,
    start: u32,
    end: u32,
}

const EMPTY_SLOT: EndpointSlot = EndpointSlot {
    key: EMPTY_KEY,
    start: NONE,
    end: NONE,
};

#[derive(Clone, Copy)]
struct EdgeState {
    next_start: u32,
    next_end: u32,
    accessed: bool,
}

// A bounded integer hash map with insertion-ordered linked candidate lists.
// Explicit slots avoid infallible per-endpoint allocations and hidden table
// capacity. Keys cannot equal EMPTY_KEY under the validated raster dimensions.
struct EndpointIndex {
    slots: Vec<EndpointSlot>,
    states: Vec<EdgeState>,
    count: usize,
}

fn hash_slot(key: u64, mask: usize) -> usize {
    // Wrapping arithmetic here is intentional hash mixing, not size arithmetic.
    let mut hash = key ^ (key >> 30);
    hash = hash.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    hash ^= hash >> 27;
    hash = hash.wrapping_mul(0x94d0_49bb_1331_11eb);
    ((hash ^ (hash >> 31)) as usize) & mask
}

impl EndpointIndex {
    fn new(edges: &[Boundary], scratch: &mut Scratch) -> Result<Self, ComputeError> {
        let mut index = Self {
            slots: Vec::new(),
            states: Vec::new(),
            count: 0,
        };
        scratch.resize(
            &mut index.states,
            edges.len(),
            EdgeState {
                next_start: NONE,
                next_end: NONE,
                accessed: false,
            },
        )?;
        // Reverse insertion makes each endpoint's linked list ascend by the
        // original edge order, including duplicate and branching endpoints.
        for (edge_index, edge) in edges.iter().enumerate().rev() {
            let id = u32::try_from(edge_index).map_err(|_| ComputeError::SizeLimitExceeded)?;
            let start_slot = index.ensure(edge.start.key(), scratch)?;
            index.states[edge_index].next_start = index.slots[start_slot].start;
            index.slots[start_slot].start = id;
            let end_slot = index.ensure(edge.end.key(), scratch)?;
            index.states[edge_index].next_end = index.slots[end_slot].end;
            index.slots[end_slot].end = id;
        }
        Ok(index)
    }

    fn position(&self, key: u64) -> Option<usize> {
        if self.slots.is_empty() {
            return None;
        }
        let mask = self.slots.len() - 1;
        let mut position = hash_slot(key, mask);
        loop {
            match self.slots[position].key {
                EMPTY_KEY => return None,
                found if found == key => return Some(position),
                _ => position = (position + 1) & mask,
            }
        }
    }

    fn ensure(&mut self, key: u64, scratch: &mut Scratch) -> Result<usize, ComputeError> {
        if let Some(position) = self.position(key) {
            return Ok(position);
        }
        if self.count >= self.slots.len() - self.slots.len() / 4 {
            let length = self
                .slots
                .len()
                .checked_mul(2)
                .ok_or(ComputeError::SizeLimitExceeded)?
                .max(16);
            let mut slots = Vec::new();
            scratch.resize(&mut slots, length, EMPTY_SLOT)?;
            let mask = length - 1;
            for slot in &self.slots {
                if slot.key == EMPTY_KEY {
                    continue;
                }
                let mut position = hash_slot(slot.key, mask);
                while slots[position].key != EMPTY_KEY {
                    position = (position + 1) & mask;
                }
                slots[position] = *slot;
            }
            scratch.release(&mut self.slots);
            self.slots = slots;
        }
        let mask = self.slots.len() - 1;
        let mut position = hash_slot(key, mask);
        while self.slots[position].key != EMPTY_KEY {
            position = (position + 1) & mask;
        }
        self.slots[position].key = key;
        self.count += 1;
        Ok(position)
    }

    fn take(&mut self, point: Point, start: bool) -> Option<usize> {
        let position = self.position(point.key())?;
        let mut candidate = if start {
            self.slots[position].start
        } else {
            self.slots[position].end
        };
        while candidate != NONE {
            let state = &mut self.states[candidate as usize];
            let next = if start {
                state.next_start
            } else {
                state.next_end
            };
            if start {
                self.slots[position].start = next;
            } else {
                self.slots[position].end = next;
            }
            if !state.accessed {
                state.accessed = true;
                return Some(candidate as usize);
            }
            candidate = next;
        }
        None
    }

    fn release(&mut self, scratch: &mut Scratch) {
        scratch.release(&mut self.slots);
        scratch.release(&mut self.states);
    }
}

fn concat_edges(
    edges: &[Boundary],
    scratch: &mut Scratch,
    output: &mut Output,
) -> Result<u32, ComputeError> {
    let mut index = EndpointIndex::new(edges, scratch)?;
    let mut prepended = Vec::new();
    let mut appended = Vec::new();
    let mut path_count = 0_u32;
    for (i, initial) in edges.iter().enumerate() {
        if index.states[i].accessed {
            continue;
        }
        index.states[i].accessed = true;
        prepended.clear();
        appended.clear();
        scratch.push(&mut appended, initial.start)?;
        scratch.push(&mut appended, initial.end)?;
        let mut head = initial.start;
        let mut tail = initial.end;
        loop {
            let mut found_new = false;
            if let Some(previous) = index.take(head, false) {
                head = edges[previous].start;
                scratch.push(&mut prepended, head)?;
                found_new = true;
            }
            if let Some(next) = index.take(tail, true) {
                tail = edges[next].end;
                scratch.push(&mut appended, tail)?;
                found_new = true;
            }
            if !found_new {
                break;
            }
        }

        let path_offset = output.append(scratch, &[0])?;
        let mut point_count = 0_u32;
        let mut last_point = prepended.last().copied().unwrap_or(initial.start);
        let mut previous_point = last_point;
        for point in prepended.iter().rev().chain(appended.iter()).copied() {
            if point_count >= 2 && (point.x == last_point.x || point.y == last_point.y) {
                let offset = output.bytes.len() - 8;
                output.word(offset, point.x);
                output.word(offset + 4, point.y);
            } else {
                if point_count >= 2 {
                    last_point = previous_point;
                }
                output.append(scratch, &[point.x, point.y])?;
                point_count = point_count
                    .checked_add(1)
                    .ok_or(ComputeError::SizeLimitExceeded)?;
            }
            previous_point = point;
        }
        output.word(path_offset, point_count);
        path_count = path_count
            .checked_add(1)
            .ok_or(ComputeError::SizeLimitExceeded)?;
    }
    scratch.release(&mut prepended);
    scratch.release(&mut appended);
    index.release(scratch);
    Ok(path_count)
}

fn color(input: &[u8], index: usize) -> u32 {
    let offset = index * 4;
    u32::from_le_bytes([
        input[offset],
        input[offset + 1],
        input[offset + 2],
        input[offset + 3],
    ])
}

fn visited(pixels: &[u8], index: usize) -> bool {
    pixels[index >> 3] & (1 << (index & 7)) != 0
}

fn mark(pixels: &mut [u8], index: usize) {
    pixels[index >> 3] |= 1 << (index & 7);
}

fn find_edges(
    start: usize,
    input: &[u8],
    layout: EdgesLayout,
    pixels: &mut [u8],
    stack: &mut Vec<u32>,
    edges: &mut Vec<Boundary>,
    scratch: &mut Scratch,
) -> Result<usize, ComputeError> {
    let from_color = color(input, start);
    scratch.push(stack, start as u32)?;
    let mut pixel_count = 0;
    while let Some(pixel_index) = stack.pop() {
        let pixel_index = pixel_index as usize;
        let x = pixel_index % layout.width;
        let y = pixel_index / layout.width;
        pixel_count += 1;
        // Input extents prove all pixel/coordinate arithmetic below fits even
        // on wasm32. Sentinel rows do not wrap; x neighbors do, even at width 1.
        let neighbors = [
            Some(if x == 0 {
                pixel_index + layout.width - 1
            } else {
                pixel_index - 1
            }),
            pixel_index.checked_sub(layout.width),
            Some(if x == layout.width - 1 {
                pixel_index - (layout.width - 1)
            } else {
                pixel_index + 1
            }),
            if y == layout.height - 1 {
                None
            } else {
                Some(pixel_index + layout.width)
            },
        ];
        let x = x as u32;
        let y = y as u32;
        let corners = [
            Point { x, y: y + 1 },
            Point { x, y },
            Point { x: x + 1, y },
            Point { x: x + 1, y: y + 1 },
        ];
        for (side, neighbor) in neighbors.into_iter().enumerate() {
            let to_color = neighbor.map_or(NONE, |index| color(input, index));
            if to_color != from_color {
                let order =
                    u32::try_from(edges.len()).map_err(|_| ComputeError::SizeLimitExceeded)?;
                scratch.push(
                    edges,
                    Boundary {
                        to_color,
                        order,
                        start: corners[side],
                        end: corners[(side + 1) % 4],
                    },
                )?;
            } else if let Some(neighbor) = neighbor {
                if !visited(pixels, neighbor) {
                    mark(pixels, neighbor);
                    scratch.push(stack, neighbor as u32)?;
                }
            }
        }
    }
    Ok(pixel_count)
}

/// Scan top-to-bottom LE u32 packed 0x00RRGGBB pixels with horizontal wrapping.
/// Extra input bytes are ignored, but count toward the 128 MiB input limit.
///
/// ABI v1's 12-byte header is [totalBytes, payloadBytes, 0]. The payload contains
/// LE u32 words [1, groupCount, onePixelCount, crossingCount], then component
/// groups [fromColor, toColor, pathCount] and paths [pointCount, x, y, ...].
/// Neighbor colors ascend within each component, with 0xffffffff (-1) last;
/// disconnected components remain separate groups in flood discovery order.
/// One-pixel [color, x, y] records follow all groups, then [x, yTop] crossings
/// in y/x scan order. Coordinates include the unwrapped right/bottom endpoints.
pub fn scan_edges(input: &[u8], width: u32, height: u32) -> Result<Box<[u8]>, ComputeError> {
    let layout = EdgesLayout::new(input.len(), width, height)?;
    scan_with_layout(input, layout)
}

pub(crate) fn scan_with_layout(
    input: &[u8],
    layout: EdgesLayout,
) -> Result<Box<[u8]>, ComputeError> {
    if input[..layout.input_bytes]
        .chunks_exact(4)
        .any(|word| word[3] != 0)
    {
        return Err(ComputeError::InvalidParameters);
    }
    let mut scratch = Scratch {
        used: 0,
        limit: MAX_SCRATCH_BYTES,
    };
    let mut output = Output::new(&mut scratch)?;
    let mut pixels = Vec::new();
    let pixel_count = layout.input_bytes / 4;
    let visited_bytes = pixel_count
        .checked_add(7)
        .ok_or(ComputeError::SizeLimitExceeded)?
        / 8;
    scratch.resize(&mut pixels, visited_bytes, 0_u8)?;
    let mut stack = Vec::new();
    let mut edges = Vec::new();
    let mut one_pixels = Vec::new();
    let mut group_count = 0_u32;
    for start in 0..pixel_count {
        if visited(&pixels, start) {
            continue;
        }
        mark(&mut pixels, start);
        edges.clear();
        let count = find_edges(
            start,
            input,
            layout,
            &mut pixels,
            &mut stack,
            &mut edges,
            &mut scratch,
        )?;
        let from_color = color(input, start);
        if count == 1 {
            scratch.push(
                &mut one_pixels,
                [
                    from_color,
                    (start % layout.width) as u32,
                    (start / layout.width) as u32,
                ],
            )?;
        }
        // JS Object.entries sorts numeric color keys, then the nonnumeric -1.
        // Sorting by the original insertion id avoids a stable sort's hidden
        // allocation while preserving candidate order inside each color group.
        edges.sort_unstable_by_key(|edge| (edge.to_color, edge.order));
        let mut first = 0;
        while first < edges.len() {
            let to_color = edges[first].to_color;
            let mut end = first + 1;
            while end < edges.len() && edges[end].to_color == to_color {
                end += 1;
            }
            let group_offset = output.append(&mut scratch, &[from_color, to_color, 0])?;
            let paths = concat_edges(&edges[first..end], &mut scratch, &mut output)?;
            output.word(group_offset + 8, paths);
            group_count = group_count
                .checked_add(1)
                .ok_or(ComputeError::SizeLimitExceeded)?;
            first = end;
        }
    }
    scratch.release(&mut pixels);
    scratch.release(&mut stack);
    scratch.release(&mut edges);
    let one_pixel_count =
        u32::try_from(one_pixels.len()).map_err(|_| ComputeError::SizeLimitExceeded)?;
    for record in &one_pixels {
        output.append(&mut scratch, record)?;
    }
    scratch.release(&mut one_pixels);

    let mut crossing_count = 0_u32;
    for y in 1..layout.height {
        for x in 0..layout.width {
            let index = y * layout.width + x;
            let next = if x == layout.width - 1 {
                index - (layout.width - 1)
            } else {
                index + 1
            };
            let bottom_left = color(input, index);
            let bottom_right = color(input, next);
            let top_left = color(input, index - layout.width);
            let top_right = color(input, next - layout.width);
            if bottom_left != bottom_right
                && bottom_left != top_left
                && bottom_left != top_right
                && bottom_right != top_left
                && bottom_right != top_right
                && top_left != top_right
            {
                output.append(&mut scratch, &[x as u32, (y - 1) as u32])?;
                crossing_count = crossing_count
                    .checked_add(1)
                    .ok_or(ComputeError::SizeLimitExceeded)?;
            }
        }
    }
    output.word(RESULT_HEADER_BYTES + 4, group_count);
    output.word(RESULT_HEADER_BYTES + 8, one_pixel_count);
    output.word(RESULT_HEADER_BYTES + 12, crossing_count);
    output.finish()
}

#[cfg(test)]
#[path = "edges_tests.rs"]
mod tests;
