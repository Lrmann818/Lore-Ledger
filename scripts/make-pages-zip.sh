#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
verify_script="$script_dir/verify-zip.sh"
project_name="LoreLedger"
target="web"

output_dir="${1:-$project_root/release}"
tmp_files=()

cleanup() {
  local tmp_file
  for tmp_file in "${tmp_files[@]:-}"; do
    [[ -n "$tmp_file" ]] && rm -f "$tmp_file"
  done
}
trap cleanup EXIT

index_references_manifest() {
  local html_file="$1"

  if ! [[ -f "$html_file" ]]; then
    return 1
  fi

  tr '\n\r\t' '   ' < "$html_file" \
    | tr '[:upper:]' '[:lower:]' \
    | grep -qiE '<link[^>]*rel=["'"'"'][^"'"'"']*manifest[^"'"'"']*["'"'"'][^>]*href=["'"'"'](\./|/)?manifest\.json([?#][^"'"'"']*)?["'"'"']|<link[^>]*href=["'"'"'](\./|/)?manifest\.json([?#][^"'"'"']*)?["'"'"'][^>]*rel=["'"'"'][^"'"'"']*manifest[^"'"'"']*["'"'"']'
}

if ! command -v zip >/dev/null 2>&1; then
  echo "Error: 'zip' is required but not installed." >&2
  echo "Install it first, then rerun (Ubuntu/Debian: sudo apt install zip)." >&2
  exit 1
fi

if [[ ! -f "$project_root/index.html" ]]; then
  echo "Error: Required runtime file missing: index.html" >&2
  exit 1
fi

required_entries=(index.html styles.css app.js boot.js js icons)
missing_entries=()
for entry in "${required_entries[@]}"; do
  if [[ ! -e "$project_root/$entry" ]]; then
    missing_entries+=("$entry")
  fi
done

if index_references_manifest "$project_root/index.html" && [[ ! -f "$project_root/manifest.json" ]]; then
  missing_entries+=("manifest.json (referenced by index.html)")
fi

if [[ ${#missing_entries[@]} -gt 0 ]]; then
  echo "Error: Missing required runtime entries:" >&2
  for entry in "${missing_entries[@]}"; do
    echo " - $entry" >&2
  done
  exit 1
fi

mkdir -p "$output_dir"

timestamp="$(date '+%Y%m%d-%H%M')"
zip_name="$project_name-$target-$timestamp.zip"
zip_path="$output_dir/$zip_name"

include_roots=(index.html styles.css app.js boot.js js icons)
if [[ -f "$project_root/manifest.json" ]]; then
  include_roots+=(manifest.json)
fi

add_runtime_path_if_exists() {
  local raw_path="$1"
  local normalized="$raw_path"

  normalized="${normalized%%\?*}"
  normalized="${normalized%%#*}"
  normalized="${normalized#./}"
  normalized="${normalized#/}"

  if [[ -z "$normalized" ]]; then
    return 0
  fi
  if [[ "$normalized" == http://* || "$normalized" == https://* || "$normalized" == data:* || "$normalized" == blob:* || "$normalized" == //* ]]; then
    return 0
  fi
  if [[ "$normalized" == ../* ]]; then
    return 0
  fi
  if [[ ! -e "$project_root/$normalized" ]]; then
    return 0
  fi

  local existing
  for existing in "${include_roots[@]}"; do
    if [[ "$existing" == "$normalized" ]]; then
      return 0
    fi
  done
  include_roots+=("$normalized")
}

reference_sources=("$project_root/index.html")
if [[ -f "$project_root/manifest.json" ]]; then
  reference_sources+=("$project_root/manifest.json")
fi
while IFS= read -r js_file; do
  reference_sources+=("$js_file")
done < <(find "$project_root/js" -type f -name "*.js" 2>/dev/null | LC_ALL=C sort)
while IFS= read -r css_file; do
  reference_sources+=("$css_file")
done < <(
  find "$project_root" \
    \( -path "$project_root/node_modules" -o -path "$project_root/dist" -o -path "$project_root/.git" \) -prune \
    -o -type f -name "*.css" -print 2>/dev/null \
    | LC_ALL=C sort
)

for source_file in "${reference_sources[@]}"; do
  while IFS= read -r candidate; do
    add_runtime_path_if_exists "$candidate"
  done < <(
    grep -Eo '["'"'"'][^"'"'"']+\.(png|jpe?g|gif|svg|webp|ico|json|css|js|woff2?|ttf|otf|mp3|wav|ogg|mp4|webm)(\?[^"'"'"']*)?(#[^"'"'"']*)?["'"'"']' "$source_file" \
      | sed -E "s/^['\"]//; s/['\"]$//" \
      || true
  )
  while IFS= read -r candidate; do
    add_runtime_path_if_exists "$candidate"
  done < <(
    grep -Eoi 'url\([^)]*\)' "$source_file" \
      | sed -E "s/^url\\((.*)\\)$/\\1/I; s/^[[:space:]]+//; s/[[:space:]]+$//; s/^['\"]//; s/['\"]$//" \
      || true
  )
done

tmp_list="$(mktemp)"
tmp_files+=("$tmp_list")

(
  cd "$project_root"
  for path in "${include_roots[@]}"; do
    if [[ -d "$path" ]]; then
      find "$path" -type f -print
    elif [[ -f "$path" ]]; then
      echo "$path"
    fi
  done | LC_ALL=C sort -u > "$tmp_list"
)

included_count="$(wc -l < "$tmp_list" | tr -d '[:space:]')"
if [[ "$included_count" == "0" ]]; then
  echo "Error: No files selected for pages deploy zip." >&2
  exit 1
fi

(
  cd "$project_root"
  zip -q -X "$zip_path" -@ < "$tmp_list"
)

echo "Pages deploy zip created: $zip_path"
echo "Included file count: $included_count"

if [[ ! -f "$verify_script" ]]; then
  echo "Error: Verification script not found: $verify_script" >&2
  exit 1
fi

bash "$verify_script" --mode pages "$zip_path"
