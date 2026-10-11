use super::*;
use std::collections::BTreeMap;

#[derive(Debug, PartialEq, Eq)]
struct Group {
    from: u32,
    to: u32,
    paths: Vec<Vec<Point>>,
}

#[derive(Debug, PartialEq, Eq)]
struct Scan {
    groups: Vec<Group>,
    one_pixels: Vec<[u32; 3]>,
    crossings: Vec<[u32; 2]>,
}

fn point(x: u32, y: u32) -> Point {
    Point { x, y }
}

fn input(colors: &[u32]) -> Vec<u8> {
    colors
        .iter()
        .flat_map(|color| color.to_le_bytes())
        .collect()
}

fn words(bytes: &[u8]) -> Vec<u32> {
    assert_eq!(bytes.len() % 4, 0);
    bytes
        .chunks_exact(4)
        .map(|word| u32::from_le_bytes(word.try_into().unwrap()))
        .collect()
}

fn decode(bytes: &[u8]) -> Scan {
    let words = words(bytes);
    assert_eq!(words[0] as usize, bytes.len());
    assert_eq!(words[1] as usize, bytes.len() - RESULT_HEADER_BYTES);
    assert_eq!(words[2], 0);
    assert_eq!(words[3], 1);
    let mut offset = 7;
    let mut groups = Vec::new();
    for _ in 0..words[4] {
        let from = words[offset];
        let to = words[offset + 1];
        let path_count = words[offset + 2];
        offset += 3;
        let mut paths = Vec::new();
        for _ in 0..path_count {
            let point_count = words[offset];
            offset += 1;
            let mut path = Vec::new();
            for _ in 0..point_count {
                path.push(point(words[offset], words[offset + 1]));
                offset += 2;
            }
            paths.push(path);
        }
        groups.push(Group { from, to, paths });
    }
    let mut one_pixels = Vec::new();
    for _ in 0..words[5] {
        one_pixels.push(words[offset..offset + 3].try_into().unwrap());
        offset += 3;
    }
    let mut crossings = Vec::new();
    for _ in 0..words[6] {
        crossings.push(words[offset..offset + 2].try_into().unwrap());
        offset += 2;
    }
    assert_eq!(offset, words.len(), "no padding or trailing records");
    Scan {
        groups,
        one_pixels,
        crossings,
    }
}

fn scan(colors: &[u32], width: u32, height: u32) -> Scan {
    decode(&scan_edges(&input(colors), width, height).unwrap())
}

fn scratch() -> Scratch {
    Scratch {
        used: 0,
        limit: MAX_SCRATCH_BYTES,
    }
}

fn concat(segments: &[(Point, Point)]) -> Vec<Vec<Point>> {
    let mut scratch = scratch();
    let mut output = Output::new(&mut scratch).unwrap();
    let edges: Vec<_> = segments
        .iter()
        .enumerate()
        .map(|(order, &(start, end))| Boundary {
            to_color: 2,
            order: order as u32,
            start,
            end,
        })
        .collect();
    let offset = output.append(&mut scratch, &[1, 2, 0]).unwrap();
    let count = concat_edges(&edges, &mut scratch, &mut output).unwrap();
    output.word(offset + 8, count);
    output.word(RESULT_HEADER_BYTES + 4, 1);
    assert_eq!(scratch.used, output.bytes.capacity());
    decode(&output.finish().unwrap()).groups.remove(0).paths
}

// Independent, direct transcription of the legacy walk, using a linear search
// instead of the production endpoint index. This also covers unusual reduction
// inputs rather than assuming that every path is a simple orthogonal polygon.
fn legacy_concat(edges: &[(Point, Point)]) -> Vec<Vec<Point>> {
    let mut accessed = vec![false; edges.len()];
    let mut paths = Vec::new();
    for (i, &(mut head, mut tail)) in edges.iter().enumerate() {
        if accessed[i] {
            continue;
        }
        let mut prepended = Vec::new();
        let mut appended = vec![head, tail];
        accessed[i] = true;
        loop {
            let mut found_new = false;
            if let Some((index, &(start, _))) = edges
                .iter()
                .enumerate()
                .find(|(index, edge)| !accessed[*index] && edge.1 == head)
            {
                accessed[index] = true;
                head = start;
                prepended.push(head);
                found_new = true;
            }
            if let Some((index, &(_, end))) = edges
                .iter()
                .enumerate()
                .find(|(index, edge)| !accessed[*index] && edge.0 == tail)
            {
                accessed[index] = true;
                tail = end;
                appended.push(tail);
                found_new = true;
            }
            if !found_new {
                break;
            }
        }
        prepended.reverse();
        prepended.extend(appended);
        let mut last_point = prepended[0];
        let mut reduced = Vec::new();
        for point in prepended {
            if reduced.len() < 2 {
                reduced.push(point);
            } else if point.x == last_point.x || point.y == last_point.y {
                *reduced.last_mut().unwrap() = point;
            } else {
                last_point = *reduced.last().unwrap();
                reduced.push(point);
            }
        }
        paths.push(reduced);
    }
    paths
}

fn legacy_scan(colors: &[u32], width: usize, height: usize) -> Scan {
    let mut accessed = vec![false; colors.len()];
    let mut scan = Scan {
        groups: Vec::new(),
        one_pixels: Vec::new(),
        crossings: Vec::new(),
    };
    for start in 0..colors.len() {
        if accessed[start] {
            continue;
        }
        accessed[start] = true;
        let from = colors[start];
        let mut stack = vec![start];
        let mut count = 0;
        let mut groups: BTreeMap<u32, Vec<(Point, Point)>> = BTreeMap::new();
        while let Some(index) = stack.pop() {
            count += 1;
            let x = index % width;
            let y = index / width;
            let neighbors = [
                Some(y * width + (x + width - 1) % width),
                (y > 0).then(|| (y - 1) * width + x),
                Some(y * width + (x + 1) % width),
                (y + 1 < height).then(|| (y + 1) * width + x),
            ];
            let offsets = [
                ((0, 1), (0, 0)),
                ((0, 0), (1, 0)),
                ((1, 0), (1, 1)),
                ((1, 1), (0, 1)),
            ];
            for (side, neighbor) in neighbors.into_iter().enumerate() {
                let to = neighbor.map_or(NONE, |neighbor| colors[neighbor]);
                if from != to {
                    let (a, b) = offsets[side];
                    groups.entry(to).or_default().push((
                        point((x + a.0) as u32, (y + a.1) as u32),
                        point((x + b.0) as u32, (y + b.1) as u32),
                    ));
                } else if let Some(neighbor) = neighbor {
                    if !accessed[neighbor] {
                        accessed[neighbor] = true;
                        stack.push(neighbor);
                    }
                }
            }
        }
        if count == 1 {
            scan.one_pixels
                .push([from, (start % width) as u32, (start / width) as u32]);
        }
        for (to, segments) in groups {
            scan.groups.push(Group {
                from,
                to,
                paths: legacy_concat(&segments),
            });
        }
    }
    for y in 1..height {
        for x in 0..width {
            let next_x = (x + 1) % width;
            let corners = [
                colors[y * width + x],
                colors[y * width + next_x],
                colors[(y - 1) * width + x],
                colors[(y - 1) * width + next_x],
            ];
            if (0..4).all(|a| (a + 1..4).all(|b| corners[a] != corners[b])) {
                scan.crossings.push([x as u32, (y - 1) as u32]);
            }
        }
    }
    scan
}

fn encode(scan: &Scan) -> Vec<u32> {
    let mut words = vec![
        0,
        0,
        0,
        1,
        scan.groups.len() as u32,
        scan.one_pixels.len() as u32,
        scan.crossings.len() as u32,
    ];
    for group in &scan.groups {
        words.extend([group.from, group.to, group.paths.len() as u32]);
        for path in &group.paths {
            words.push(path.len() as u32);
            for point in path {
                words.extend([point.x, point.y]);
            }
        }
    }
    for record in &scan.one_pixels {
        words.extend(record);
    }
    for record in &scan.crossings {
        words.extend(record);
    }
    words[0] = (words.len() * 4) as u32;
    words[1] = words[0] - RESULT_HEADER_BYTES as u32;
    words
}

#[test]
fn exact_one_pixel_serialization_and_initial_visit() {
    let result = scan_edges(&7_u32.to_le_bytes(), 1, 1).unwrap();
    assert_eq!(
        words(&result),
        [92, 80, 0, 1, 1, 1, 0, 7, NONE, 2, 2, 0, 0, 1, 0, 2, 1, 1, 0, 1, 7, 0, 0]
    );
    assert!(scan(&[7, 7], 1, 2).one_pixels.is_empty());
}

#[test]
fn horizontal_seam_connects_pixels_but_does_not_wrap_endpoints() {
    let result = scan(&[7, 9, 7], 3, 1);
    assert_eq!(
        result
            .groups
            .iter()
            .map(|g| (g.from, g.to))
            .collect::<Vec<_>>(),
        [(7, 9), (7, NONE), (9, 7), (9, NONE)]
    );
    assert_eq!(
        result.groups[0].paths,
        [
            vec![point(1, 0), point(1, 1)],
            vec![point(2, 1), point(2, 0)]
        ]
    );
    assert_eq!(
        result.groups[1].paths,
        [
            vec![point(0, 0), point(1, 0)],
            vec![point(1, 1), point(0, 1)],
            vec![point(2, 0), point(3, 0)],
            vec![point(3, 1), point(2, 1)],
        ]
    );
    assert_eq!(result.one_pixels, [[9, 1, 0]]);
}

#[test]
fn disconnected_components_keep_local_neighbor_order_and_warning_order() {
    let result = scan(&[20, 3, 20, 1, 9], 5, 1);
    let neighbors: Vec<_> = result
        .groups
        .iter()
        .filter(|g| g.from == 20)
        .map(|g| g.to)
        .collect();
    assert_eq!(neighbors, [3, 9, NONE, 1, 3, NONE]);
    assert_eq!(
        result.one_pixels,
        [[20, 0, 0], [3, 1, 0], [20, 2, 0], [1, 3, 0], [9, 4, 0]]
    );
    assert_eq!(result, legacy_scan(&[20, 3, 20, 1, 9], 5, 1));
}

#[test]
fn hole_keeps_directed_closed_path_and_outer_sentinels() {
    let colors = [
        7, 7, 7, 7, 7, 7, 9, 9, 9, 7, 7, 9, 9, 9, 7, 7, 9, 9, 9, 7, 7, 7, 7, 7, 7,
    ];
    let result = scan(&colors, 5, 5);
    assert_eq!(result, legacy_scan(&colors, 5, 5));
    assert_eq!(
        result
            .groups
            .iter()
            .map(|g| (g.from, g.to))
            .collect::<Vec<_>>(),
        [(7, 9), (7, NONE), (9, 7)]
    );
    let hole = &result.groups[0].paths[0];
    assert_eq!(hole.len(), 5);
    assert_eq!(hole.first(), hole.last());
    for corner in [point(1, 1), point(4, 1), point(4, 4), point(1, 4)] {
        assert!(hole.contains(&corner));
    }
    assert!(result.one_pixels.is_empty());
}

#[test]
fn sentinel_rows_are_separate_and_colors_include_black_and_white() {
    let result = scan(&[0, 0, 0, 0], 2, 2);
    assert_eq!(
        result.groups,
        [Group {
            from: 0,
            to: NONE,
            paths: vec![
                vec![point(0, 0), point(2, 0)],
                vec![point(2, 2), point(0, 2)]
            ],
        }]
    );
    assert!(result.one_pixels.is_empty());
    let white = scan(&[0x00ff_ffff], 1, 1);
    assert_eq!(white.groups[0].from, 0x00ff_ffff);
    assert_eq!(white.groups[0].to, NONE);
}

#[test]
fn crossings_include_wrapped_seam_and_follow_y_then_x() {
    assert_eq!(scan(&[1, 2, 3, 4], 2, 2).crossings, [[0, 0], [1, 0]]);
    assert_eq!(scan(&[1, 1, 2, 3, 3, 4], 3, 2).crossings, [[1, 0], [2, 0]]);
    assert_eq!(
        scan(&[1, 2, 3, 4, 5, 6, 7, 8, 9], 3, 3).crossings,
        [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]
    );
    assert!(scan(&[1, 2, 3], 1, 3).crossings.is_empty());
    for a in 0..4 {
        for b in a + 1..4 {
            let mut colors = [1, 2, 3, 4];
            colors[b] = colors[a];
            assert!(scan(&colors, 2, 2).crossings.is_empty());
        }
    }
}

#[test]
fn concat_alternates_ends_and_chooses_first_unaccessed_candidate() {
    let segments = [
        (point(1, 0), point(2, 0)),
        (point(0, 0), point(1, 0)),
        (point(3, 0), point(1, 0)),
        (point(2, 0), point(2, 1)),
        (point(2, 0), point(2, 2)),
        (point(2, 1), point(3, 1)),
    ];
    let result = concat(&segments);
    assert_eq!(
        result,
        [
            vec![point(0, 0), point(2, 0), point(2, 1), point(3, 1)],
            vec![point(3, 0), point(1, 0)],
            vec![point(2, 0), point(2, 2)],
        ]
    );
    assert_eq!(result, legacy_concat(&segments));
}

#[test]
fn concat_preserves_legacy_odd_collinear_reduction_and_duplicate_edges() {
    let cases = [
        vec![(point(0, 0), point(1, 1)), (point(1, 1), point(0, 2))],
        vec![
            (point(0, 0), point(1, 0)),
            (point(1, 0), point(0, 0)),
            (point(0, 0), point(0, 1)),
        ],
        vec![
            (point(0, 0), point(0, 0)),
            (point(0, 0), point(0, 0)),
            (point(0, 0), point(1, 0)),
        ],
        vec![
            (point(0, 0), point(1, 0)),
            (point(1, 0), point(1, 1)),
            (point(1, 1), point(0, 1)),
            (point(0, 1), point(0, 0)),
        ],
    ];
    assert_eq!(concat(&cases[0]), [vec![point(0, 0), point(0, 2)]]);
    assert_eq!(
        concat(&cases[1]),
        [
            vec![point(1, 0), point(1, 0)],
            vec![point(0, 0), point(0, 1)]
        ]
    );
    for case in &cases {
        assert_eq!(concat(case), legacy_concat(case));
    }
    assert!(concat(&[]).is_empty());
}

#[test]
fn concat_reduces_large_reverse_chain() {
    let segments: Vec<_> = (0..20_000)
        .map(|x| (point(x + 1, 0), point(x, 0)))
        .collect();
    assert_eq!(concat(&segments), [vec![point(20_000, 0), point(0, 0)]]);
}

#[test]
fn serialized_results_match_legacy_for_all_small_binary_rasters() {
    for width in 1..=4 {
        for height in 1..=3 {
            let count = width * height;
            for pattern in 0_u32..1 << count {
                let colors: Vec<_> = (0..count)
                    .map(|i| if pattern & (1 << i) == 0 { 0 } else { 0xabcdef })
                    .collect();
                let actual = scan_edges(&input(&colors), width as u32, height as u32).unwrap();
                assert_eq!(
                    words(&actual),
                    encode(&legacy_scan(&colors, width, height)),
                    "{width}x{height}, pattern {pattern}"
                );
            }
        }
    }
}

fn random(seed: &mut u64) -> u32 {
    *seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
    (*seed >> 32) as u32
}

#[test]
fn serialized_results_match_legacy_for_multicolor_rasters() {
    let mut seed = 0x1357_2468_abcdef;
    let palette = [0, 1, 0x00010203, 0xff0000, 0x00ff_ffff];
    for _ in 0..1_000 {
        let width = (random(&mut seed) % 8 + 1) as usize;
        let height = (random(&mut seed) % 8 + 1) as usize;
        let colors: Vec<_> = (0..width * height)
            .map(|_| palette[random(&mut seed) as usize % palette.len()])
            .collect();
        let actual = scan_edges(&input(&colors), width as u32, height as u32).unwrap();
        assert_eq!(
            words(&actual),
            encode(&legacy_scan(&colors, width, height)),
            "{width}x{height}: {colors:?}"
        );
    }
}

#[test]
fn indexed_concat_matches_legacy_for_arbitrary_ordered_segments() {
    let mut seed = 0xabc123;
    for _ in 0..500 {
        let count = random(&mut seed) % 30;
        let segments: Vec<_> = (0..count)
            .map(|_| {
                (
                    point(random(&mut seed) % 4, random(&mut seed) % 4),
                    point(random(&mut seed) % 4, random(&mut seed) % 4),
                )
            })
            .collect();
        assert_eq!(concat(&segments), legacy_concat(&segments), "{segments:?}");
    }
}

#[test]
fn invalid_dimensions_colors_and_truncated_rasters_return_errors() {
    assert_eq!(scan_edges(&[], 0, 1), Err(ComputeError::InvalidParameters));
    assert_eq!(scan_edges(&[], 1, 0), Err(ComputeError::InvalidParameters));
    assert_eq!(
        scan_edges(&[], u32::MAX, u32::MAX),
        Err(ComputeError::SizeLimitExceeded)
    );
    assert_eq!(
        scan_edges(&[], 33_554_433, 1),
        Err(ComputeError::SizeLimitExceeded)
    );
    assert_eq!(
        EdgesLayout::new(crate::MAX_INPUT_BYTES + 1, 1, 1).err(),
        Some(ComputeError::SizeLimitExceeded)
    );
    assert_eq!(
        EdgesLayout::new(crate::MAX_INPUT_BYTES, 33_554_432, 1)
            .unwrap()
            .input_bytes,
        crate::MAX_INPUT_BYTES
    );
    let pixels = input(&[0x0100_0000, 0]);
    assert_eq!(
        scan_edges(&pixels, 2, 1),
        Err(ComputeError::InvalidParameters)
    );
    assert_eq!(
        scan_edges(&input(&[0, NONE]), 2, 1),
        Err(ComputeError::InvalidParameters)
    );
    for length in 0..8 {
        assert_eq!(
            scan_edges(&pixels[..length], 2, 1),
            Err(ComputeError::TruncatedInput)
        );
    }
    let mut extra = input(&[0x010203]);
    extra.extend([0xff; 7]);
    assert_eq!(
        scan_edges(&extra, 1, 1),
        scan_edges(&input(&[0x010203]), 1, 1)
    );
}

#[test]
fn scratch_limit_is_aggregate_and_reservations_are_fallible() {
    let mut budget = Scratch { used: 0, limit: 64 };
    let mut first = Vec::new();
    let mut second = Vec::new();
    budget.resize(&mut first, 8, 0_u32).unwrap();
    budget.resize(&mut second, 8, 0_u32).unwrap();
    assert_eq!(budget.used, 64);
    assert_eq!(
        budget.push(&mut first, 1),
        Err(ComputeError::SizeLimitExceeded)
    );
    budget.release(&mut second);
    assert_eq!(budget.used, 32);
    // New capacity must fit alongside the old allocation during growth.
    assert_eq!(
        budget.push(&mut first, 1),
        Err(ComputeError::SizeLimitExceeded)
    );
    budget.release(&mut first);
    assert_eq!(budget.used, 0);
    let mut impossible = Vec::<u8>::new();
    let mut large_budget = Scratch {
        used: 0,
        limit: usize::MAX,
    };
    assert_eq!(
        large_budget.reserve(&mut impossible, usize::MAX),
        Err(ComputeError::AllocationFailed)
    );
    let mut impossible_words = Vec::<u64>::new();
    assert_eq!(
        large_budget.reserve(&mut impossible_words, usize::MAX),
        Err(ComputeError::SizeLimitExceeded)
    );
}

#[test]
fn output_growth_checks_complete_size_without_partial_records() {
    let mut scratch = scratch();
    let mut output = Output::new(&mut scratch).unwrap();
    output.limit = 40;
    output.append(&mut scratch, &[1, 2, 3]).unwrap();
    let before = output.bytes.clone();
    assert_eq!(
        output.append(&mut scratch, &[4]),
        Err(ComputeError::SizeLimitExceeded)
    );
    assert_eq!(output.bytes, before);
    let mut small_scratch = Scratch { used: 0, limit: 28 };
    let mut output = Output::new(&mut small_scratch).unwrap();
    assert_eq!(
        output.append(&mut small_scratch, &[1]),
        Err(ComputeError::SizeLimitExceeded)
    );
}

#[test]
fn endpoint_growth_obeys_shared_scratch_limit() {
    let edges = [Boundary {
        to_color: 1,
        order: 0,
        start: point(0, 0),
        end: point(1, 0),
    }];
    let mut budget = Scratch {
        used: 0,
        limit: 128,
    };
    assert_eq!(
        EndpointIndex::new(&edges, &mut budget).err(),
        Some(ComputeError::SizeLimitExceeded)
    );
}
