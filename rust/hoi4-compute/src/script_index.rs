//! Index-only streaming script reader. Unsupported syntax rejects the entire file.
//! Tokens borrow the input; only extracted strings and scalar constants are retained.
use crate::{ComputeError, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES};
use std::borrow::Cow;
use std::collections::HashMap;

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Symbol,
    String,
    Number,
    Operator,
    End,
}
#[derive(Clone, Copy)]
struct Token<'a> {
    text: &'a str,
    kind: Kind,
}
struct Reader<'a> {
    source: &'a str,
    offset: usize,
    peeked: Option<Token<'a>>,
}
fn whitespace(c: char) -> bool {
    matches!(c, '\t'..='\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
fn delimiter(c: char) -> bool {
    whitespace(c) || matches!(c, '#' | '=' | '{' | '}' | '<' | '>' | '!' | ',' | ';')
}
fn suffix(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'.'
}
fn number_end(bytes: &[u8]) -> Option<(usize, bool)> {
    let start = usize::from(matches!(bytes.first(), Some(b'+') | Some(b'-')));
    let mut ends = [0; 4];
    let mut count = 0;
    if bytes.get(start) == Some(&b'0') && bytes.get(start + 1) == Some(&b'x') {
        let mut end = start + 2;
        while bytes.get(end).is_some_and(u8::is_ascii_hexdigit) {
            end += 1;
        }
        if end > start + 2 {
            ends[count] = end;
            count += 1;
        }
    }
    let mut integer = start;
    while bytes.get(integer).is_some_and(u8::is_ascii_digit) {
        integer += 1;
    }
    if integer > start && bytes.get(integer) == Some(&b'.') {
        let mut end = integer + 1;
        while bytes.get(end).is_some_and(u8::is_ascii_digit) {
            end += 1;
        }
        ends[count] = end;
        count += 1;
    }
    if bytes.get(start) == Some(&b'.') {
        let mut end = start + 1;
        while bytes.get(end).is_some_and(u8::is_ascii_digit) {
            end += 1;
        }
        if end > start + 1 {
            ends[count] = end;
            count += 1;
        }
    }
    if integer > start {
        ends[count] = integer;
        count += 1;
    }
    for &end in &ends[..count] {
        if bytes.get(end) == Some(&b'%') {
            return Some((
                end + 1 + usize::from(bytes.get(end + 1) == Some(&b'%')),
                false,
            ));
        }
    }
    for &end in &ends[..count] {
        if bytes.get(end).is_none_or(|&c| !suffix(c)) {
            return Some((end, true));
        }
    }
    None
}
impl<'a> Reader<'a> {
    fn peek(&mut self) -> Result<Token<'a>, ComputeError> {
        if let Some(token) = self.peeked {
            return Ok(token);
        }
        let token = self.scan()?;
        self.peeked = Some(token);
        Ok(token)
    }
    fn next(&mut self) -> Result<Token<'a>, ComputeError> {
        let token = self.peek()?;
        self.peeked = None;
        Ok(token)
    }
    fn scan(&mut self) -> Result<Token<'a>, ComputeError> {
        loop {
            while let Some(c) = self.source[self.offset..].chars().next() {
                if !whitespace(c) {
                    break;
                }
                self.offset += c.len_utf8();
            }
            let start = self.offset;
            let rest = &self.source[start..];
            let Some(c) = rest.chars().next() else {
                return Ok(Token {
                    text: "",
                    kind: Kind::End,
                });
            };
            if c == '#' {
                for c in rest.chars() {
                    if matches!(c, '\u{2028}' | '\u{2029}') {
                        return Err(ComputeError::UnsupportedFormat);
                    }
                    self.offset += c.len_utf8();
                    if matches!(c, '\n' | '\r') {
                        break;
                    }
                }
                continue;
            }
            let bytes = rest.as_bytes();
            let (length, kind) = if matches!(c, '<' | '>' | '!') && bytes.get(1) == Some(&b'=') {
                (2, Kind::Operator)
            } else if matches!(c, '=' | '{' | '}' | '<' | '>' | ',' | ';') {
                (1, Kind::Operator)
            } else if c == '"' {
                let mut end = 1;
                while end < bytes.len() {
                    if bytes[end] == b'\\' && matches!(bytes.get(end + 1), Some(b'"') | Some(b'\\'))
                    {
                        end += 2;
                    } else if bytes[end] == b'"' {
                        break;
                    } else {
                        end += 1;
                    }
                }
                // Parser's unterminated-string backtracking is deliberately handled by the oracle.
                if end == bytes.len() {
                    return Err(ComputeError::UnsupportedFormat);
                }
                (end + 1, Kind::String)
            } else if let Some((end, numeric)) = number_end(bytes) {
                (end, if numeric { Kind::Number } else { Kind::Symbol })
            } else if !delimiter(c) {
                (
                    rest.char_indices()
                        .find(|&(_, c)| delimiter(c))
                        .map_or(rest.len(), |(index, _)| index),
                    Kind::Symbol,
                )
            } else {
                return Err(ComputeError::UnsupportedFormat);
            };
            self.offset += length;
            return Ok(Token {
                text: &self.source[start..self.offset],
                kind,
            });
        }
    }
}
fn decoded(token: Token<'_>) -> Cow<'_, str> {
    if token.kind == Kind::String {
        let text = &token.text[1..token.text.len() - 1];
        if text.contains("\\\"") || text.contains("\\\\") {
            Cow::Owned(text.replace("\\\"", "\"").replace("\\\\", "\\"))
        } else {
            Cow::Borrowed(text)
        }
    } else {
        Cow::Borrowed(token.text)
    }
}
#[derive(Clone, Copy)]
enum Value<'a> {
    Scalar(Token<'a>),
    Block,
    None,
}
#[derive(Clone, Copy)]
enum Scope {
    Root,
    Shared,
    Joint,
    SpriteTypes,
    Sprite(usize),
    Ignore,
}
struct Extractor<'a> {
    reader: Reader<'a>,
    constants: HashMap<String, Token<'a>>,
    focus: bool,
    groups: [Vec<String>; 5],
}
impl<'a> Extractor<'a> {
    fn scalar(&self, token: Token<'a>) -> Result<String, ComputeError> {
        let token = if token.kind == Kind::Symbol && token.text.starts_with('@') {
            self.constants.get(token.text).copied().unwrap_or(token)
        } else {
            token
        };
        if token.kind != Kind::Number {
            return Ok(decoded(token).into_owned());
        }
        // JS Number.toString equivalence is guaranteed for safe integral values only.
        // Other numeric index keys use the full parser rather than an approximate formatter.
        let unsigned = token.text.trim_start_matches(['+', '-']);
        let value = if let Some(hex) = unsigned.strip_prefix("0x") {
            i64::from_str_radix(hex, 16)
                .ok()
                .map(|v| if token.text.starts_with('-') { -v } else { v })
        } else {
            token.text.parse::<i64>().ok()
        }
        .ok_or(ComputeError::UnsupportedFormat)?;
        if value.unsigned_abs() > 9_007_199_254_740_991 {
            return Err(ComputeError::UnsupportedFormat);
        }
        Ok(value.to_string())
    }
    fn block(&mut self, scope: Scope, depth: usize) -> Result<(), ComputeError> {
        if depth > 256 {
            return Err(ComputeError::SizeLimitExceeded);
        }
        let mut id = None;
        let mut textures = [false; 2];
        // GFX schema emits categories, not declaration order, independently for each container.
        let mut sprite_groups: [Vec<String>; 5] = std::array::from_fn(|_| Vec::new());
        loop {
            let token = self.reader.peek()?;
            if token.kind == Kind::End {
                if depth != 0 {
                    return Err(ComputeError::UnsupportedFormat);
                }
                break;
            }
            if token.text == "}" {
                if depth == 0 {
                    return Err(ComputeError::UnsupportedFormat);
                }
                self.reader.next()?;
                break;
            }
            let token = self.reader.next()?;
            if token.text == "{" {
                self.block(Scope::Ignore, depth + 1)?;
                continue;
            }
            if token.kind == Kind::Operator {
                return Err(ComputeError::UnsupportedFormat);
            }
            let name = decoded(token);
            if !name.is_ascii() || name.eq_ignore_ascii_case("constructor") || name == "__proto__" {
                return Err(ComputeError::UnsupportedFormat);
            }
            let next = self.reader.peek()?;
            let mut equals = false;
            let value = if next.kind != Kind::Operator || matches!(next.text, "," | ";" | "}") {
                Value::None
            } else {
                equals = next.text == "=" || next.text == "{";
                if next.text != "{" {
                    self.reader.next()?;
                }
                let value = self.reader.next()?;
                let child_scope = match scope {
                    Scope::Root if self.focus && name.eq_ignore_ascii_case("shared_focus") => {
                        Scope::Shared
                    }
                    Scope::Root if self.focus && name.eq_ignore_ascii_case("joint_focus") => {
                        Scope::Joint
                    }
                    Scope::Root if !self.focus && name.eq_ignore_ascii_case("spritetypes") => {
                        Scope::SpriteTypes
                    }
                    Scope::SpriteTypes => [
                        "spritetype",
                        "frameanimatedspritetype",
                        "textspritetype",
                        "corneredtilespritetype",
                        "progressbartype",
                    ]
                    .iter()
                    .position(|key| name.eq_ignore_ascii_case(key))
                    .map_or(Scope::Ignore, Scope::Sprite),
                    _ => Scope::Ignore,
                };
                if value.text == "{" {
                    if name.starts_with('@') {
                        return Err(ComputeError::UnsupportedFormat);
                    }
                    let old_length = if let Scope::Sprite(category) = child_scope {
                        self.groups[category].len()
                    } else {
                        0
                    };
                    self.block(child_scope, depth + 1)?;
                    if let Scope::Sprite(category) = child_scope {
                        sprite_groups[category].extend(self.groups[category].drain(old_length..));
                    }
                    Value::Block
                } else {
                    if matches!(value.kind, Kind::Operator | Kind::End) {
                        return Err(ComputeError::UnsupportedFormat);
                    }
                    // Attachments on recognized index objects require the full schema oracle.
                    if value.kind == Kind::Symbol && self.reader.peek()?.text == "{" {
                        if !matches!(child_scope, Scope::Ignore) {
                            return Err(ComputeError::UnsupportedFormat);
                        }
                        self.reader.next()?;
                        self.block(Scope::Ignore, depth + 1)?;
                        Value::Block
                    } else {
                        Value::Scalar(value)
                    }
                }
            };
            while matches!(self.reader.peek()?.text, "," | ";") {
                self.reader.next()?;
            }
            if name.starts_with('@') && equals {
                // Nested constants can escape recognized schema objects; reject rather than
                // incorrectly applying constants from blocks ignored by the schema oracle.
                if !matches!(scope, Scope::Root) {
                    return Err(ComputeError::UnsupportedFormat);
                }
                match value {
                    // Detail-value schemas can apply aliases twice; leave aliases to the oracle.
                    Value::Scalar(value)
                        if !(value.kind == Kind::Symbol && value.text.starts_with('@')) =>
                    {
                        self.constants.insert(name.into_owned(), value);
                    }
                    _ => return Err(ComputeError::UnsupportedFormat),
                }
                continue;
            }
            if matches!(scope, Scope::Shared | Scope::Joint | Scope::Sprite(_))
                && name.eq_ignore_ascii_case(if self.focus { "id" } else { "name" })
            {
                id = match value {
                    Value::Scalar(value) => Some(self.scalar(value)?),
                    _ => None,
                };
            }
            if let Scope::Sprite(category) = scope {
                let texture = if category == 4 {
                    "texturefile1"
                } else {
                    "texturefile"
                };
                if name.eq_ignore_ascii_case(texture)
                    || (category == 4 && name.eq_ignore_ascii_case("texturefile2"))
                {
                    let index = usize::from(name.eq_ignore_ascii_case("texturefile2"));
                    textures[index] = match value {
                        Value::Scalar(value) => {
                            let value = if value.kind == Kind::Symbol && value.text.starts_with('@')
                            {
                                self.constants.get(value.text).copied().unwrap_or(value)
                            } else {
                                value
                            };
                            value.kind != Kind::String || value.text.len() > 2
                        }
                        _ => false,
                    };
                }
            }
        }
        if let Some(id) = id.filter(|id| !id.is_empty()) {
            match scope {
                Scope::Shared => self.groups[0].push(id),
                Scope::Joint => self.groups[1].push(id),
                Scope::Sprite(category) if textures[0] && (category != 4 || textures[1]) => {
                    self.groups[category].push(id)
                }
                _ => {}
            }
        }
        if matches!(scope, Scope::SpriteTypes) {
            // Flatten each container into group zero; category four is only transient storage.
            for group in sprite_groups {
                self.groups[0].extend(group);
            }
        }
        Ok(())
    }
}
/// Serialized strings: total byte length, entry count, then length-prefixed UTF-8 strings.
/// mode 0 matches extractFocusIds (shared then joint; local focus IDs are deliberately excluded).
/// mode 1 matches getSpriteTypes(...).map(sprite => sprite.name), including texture validation.
pub fn extract_script_index(input: &[u8], mode: u32) -> Result<Box<[u8]>, ComputeError> {
    if input.len() > MAX_INPUT_BYTES || mode > 1 {
        return Err(ComputeError::InvalidParameters);
    }
    let source = std::str::from_utf8(input).map_err(|_| ComputeError::UnsupportedFormat)?;
    let mut extractor = Extractor {
        reader: Reader {
            source,
            offset: 0,
            peeked: None,
        },
        constants: HashMap::new(),
        focus: mode == 0,
        groups: std::array::from_fn(|_| Vec::new()),
    };
    extractor.block(Scope::Root, 0)?;
    let count = extractor.groups.iter().map(Vec::len).sum::<usize>();
    let length = extractor
        .groups
        .iter()
        .flatten()
        .try_fold(8usize, |length, entry| length.checked_add(4 + entry.len()))
        .ok_or(ComputeError::SizeLimitExceeded)?;
    if length > MAX_OUTPUT_BYTES {
        return Err(ComputeError::SizeLimitExceeded);
    }
    let mut output = Vec::new();
    output
        .try_reserve_exact(length)
        .map_err(|_| ComputeError::AllocationFailed)?;
    output.extend_from_slice(&(length as u32).to_le_bytes());
    output.extend_from_slice(&(count as u32).to_le_bytes());
    for entry in extractor.groups.into_iter().flatten() {
        output.extend_from_slice(&(entry.len() as u32).to_le_bytes());
        output.extend_from_slice(entry.as_bytes());
    }
    Ok(output.into_boxed_slice())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries(source: &str, mode: u32) -> Vec<String> {
        let bytes = extract_script_index(source.as_bytes(), mode).unwrap();
        assert_eq!(
            u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize,
            bytes.len()
        );
        let count = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
        let mut offset = 8;
        let mut result = Vec::new();
        for _ in 0..count {
            let length = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
            offset += 4;
            result.push(
                std::str::from_utf8(&bytes[offset..offset + length])
                    .unwrap()
                    .to_owned(),
            );
            offset += length;
        }
        assert_eq!(offset, bytes.len());
        result
    }

    #[test]
    fn focus_scope_case_constants_and_duplicates() {
        assert_eq!(entries("\u{feff}@id = \"ROOT\" joint_focus={id=JOINT} SHARED_FOCUS={id=@id} shared_focus={id=A id=B} focus_tree={focus={id=LOCAL}} other={shared_focus={id=UNRELATED}} shared_focus={id=B}", 0),
            ["ROOT", "B", "B", "JOINT"]);
        assert_eq!(
            entries(
                "shared_focus={id=0x2a} shared_focus={id=-0} joint_focus={id=20%}",
                0
            ),
            ["42", "0", "20%"]
        );
    }

    #[test]
    fn gfx_category_order_texture_requirements_and_containers() {
        assert_eq!(entries("spritetypes={progressbartype={name=P texturefile1=a texturefile2=b} corneredtilespritetype={name=C texturefile=a} textspritetype={name=T texturefile=a} frameanimatedspritetype={name=F texturefile=a} spritetype={name=S texturefile=a} spritetype={name=NO_TEXTURE} progressbartype={name=NO_SECOND texturefile1=a}} spritetypes={spritetype={name=LAST texturefile=a}}", 1),
            ["S", "F", "T", "C", "P", "LAST"]);
    }

    #[test]
    fn lexical_boundaries_comments_escapes_and_unknown_nesting() {
        assert_eq!(
            entries(
                r##"shared_focus = { id = "A\"B\\C" # id = comment
            completion_reward = { value = rgb { 1 2 3 } log = "# not a comment" }
        }"##,
                0
            ),
            ["A\"B\\C"]
        );
        assert_eq!(
            entries("shared_focus={id=123abc} joint_focus={id=.5suffix}", 0),
            ["123abc", ".5suffix"]
        );
    }

    #[test]
    fn unsupported_or_malformed_files_never_publish_partial_entries() {
        for source in [
            "shared_focus={id=VALID} shared_focus={@id=\"NESTED\" id=@id}",
            "@block={id=BLOCK} shared_focus=@block",
            "@a=@b @b=\"CHAIN\" shared_focus={id=@a}",
            "shared_focus={id=1.25}",
            "shared_focus={id=VALID",
            "shared_focus=tagged{id=ATTACHED}",
            "shared_focus={id=}",
            "shared_focus={id=\"unterminated}",
            "shared_focus={id=VALID} # bad\u{2028}",
        ] {
            assert!(
                extract_script_index(source.as_bytes(), 0).is_err(),
                "{source}"
            );
        }
        assert!(extract_script_index(&[0xff], 0).is_err());
        assert!(extract_script_index(b"", 2).is_err());
        assert_eq!(entries("", 0), Vec::<String>::new());
        let nested = format!("{}{}", "{".repeat(257), "}".repeat(257));
        assert!(extract_script_index(nested.as_bytes(), 0).is_err());
    }
}
