#!/usr/bin/env bash
set -euo pipefail
tmp_files=()

cleanup() {
  local tmp_file
  for tmp_file in "${tmp_files[@]:-}"; do
    [[ -n "$tmp_file" ]] && rm -f "$tmp_file"
  done
}
trap cleanup EXIT

usage() {
  echo "Usage: bash scripts/verify-zip.sh [--mode release|pages] <zip-path>" >&2
}

index_references_manifest() {
  local html_file="$1"

  if ! [[ -f "$html_file" ]]; then
    return 1
  fi

  tr '\n\r\t' '   ' < "$html_file" \
    | tr '[:upper:]' '[:lower:]' \
    | grep -qiE '<link[^>]*rel=["'"'"'][^"'"'"']*manifest[^"'"'"']*["'"'"'][^>]*href=["'"'"'](\./|/)?manifest\.json([?#][^"'"'"']*)?["'"'"']|<link[^>]*href=["'"'"'](\./|/)?manifest\.json([?#][^"'"'"']*)?["'"'"'][^>]*rel=["'"'"'][^"'"'"']*manifest[^"'"'"']*["'"'"']'
}

mode="release"
zip_path=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      if [[ $# -lt 2 ]]; then
        echo "Error: --mode requires a value (release|pages)." >&2
        usage
        exit 1
      fi
      mode="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -n "$zip_path" ]]; then
        echo "Error: Unexpected argument: $1" >&2
        usage
        exit 1
      fi
      zip_path="$1"
      shift
      ;;
  esac
done

if [[ -z "$zip_path" ]]; then
  usage
  exit 1
fi

if [[ "$mode" != "release" && "$mode" != "pages" ]]; then
  echo "Error: Invalid mode '$mode'. Use release or pages." >&2
  exit 1
fi

if ! command -v unzip >/dev/null 2>&1; then
  echo "Error: 'unzip' is required but not installed." >&2
  echo "Install it first, then rerun (Ubuntu/Debian: sudo apt install unzip)." >&2
  exit 1
fi

if [[ ! -f "$zip_path" ]]; then
  echo "Error: Zip file not found: $zip_path" >&2
  exit 1
fi

if ! command -v zipinfo >/dev/null 2>&1; then
  echo "Error: 'zipinfo' is required but not installed." >&2
  echo "Install it first (Ubuntu/Debian: sudo apt install unzip)." >&2
  exit 1
fi

mapfile -t entries < <(zipinfo -1 "$zip_path")

offending_entries=()
lower_entries=()
for entry in "${entries[@]}"; do
  normalized="${entry#./}"
  normalized="${normalized#/}"
  lower="$(printf '%s' "$normalized" | tr '[:upper:]' '[:lower:]')"
  lower_trimmed="${lower%/}"
  lower_entries+=("$lower")

  if [[ "$lower" == .git/* || "$lower" == */.git/* || "$lower_trimmed" == ".git" || "$lower_trimmed" == */.git ]]; then
    offending_entries+=("$entry")
    continue
  fi
  if [[ "$lower" == node_modules/* || "$lower" == */node_modules/* || "$lower_trimmed" == "node_modules" || "$lower_trimmed" == */node_modules ]]; then
    offending_entries+=("$entry")
    continue
  fi
  if [[ "$lower" == .vscode/* || "$lower" == */.vscode/* || "$lower_trimmed" == ".vscode" || "$lower_trimmed" == */.vscode ]]; then
    offending_entries+=("$entry")
    continue
  fi
  if [[ "$lower" == dist/* || "$lower" == */dist/* || "$lower_trimmed" == "dist" || "$lower_trimmed" == */dist ]]; then
    offending_entries+=("$entry")
    continue
  fi

  if [[ "$mode" == "pages" ]]; then
    if [[ "$lower" == docs/* || "$lower_trimmed" == "docs" ]]; then
      offending_entries+=("$entry")
      continue
    fi
    if [[ "$lower" == scripts/* || "$lower_trimmed" == "scripts" ]]; then
      offending_entries+=("$entry")
      continue
    fi
    if [[ "$lower" == tests/* || "$lower_trimmed" == "tests" ]]; then
      offending_entries+=("$entry")
      continue
    fi
    if [[ "$lower_trimmed" == *.md || "$lower_trimmed" == *.zip ]]; then
      offending_entries+=("$entry")
      continue
    fi
    if [[ "$lower_trimmed" == ".ds_store" || "$lower_trimmed" == "thumbs.db" ]]; then
      offending_entries+=("$entry")
      continue
    fi
    if [[ "$lower" == __macosx/* || "$lower" == */__macosx/* || "$lower_trimmed" == "__macosx" || "$lower_trimmed" == */__macosx ]]; then
      offending_entries+=("$entry")
      continue
    fi
  fi
done

if [[ "$mode" == "pages" ]]; then
  required_files=(index.html styles.css app.js boot.js)
  missing_required=()

  for required in "${required_files[@]}"; do
    found="false"
    for lower in "${lower_entries[@]}"; do
      if [[ "${lower%/}" == "$required" ]]; then
        found="true"
        break
      fi
    done
    if [[ "$found" != "true" ]]; then
      missing_required+=("$required")
    fi
  done

  has_js_dir="false"
  has_icons_dir="false"
  has_manifest="false"
  for lower in "${lower_entries[@]}"; do
    lower_trimmed="${lower%/}"
    if [[ "$lower_trimmed" == "manifest.json" ]]; then
      has_manifest="true"
    fi
    if [[ "$lower_trimmed" == "js" || "$lower" == js/* ]]; then
      has_js_dir="true"
    fi
    if [[ "$lower_trimmed" == "icons" || "$lower" == icons/* ]]; then
      has_icons_dir="true"
    fi
  done

  if [[ "$has_js_dir" != "true" ]]; then
    missing_required+=("js/")
  fi
  if [[ "$has_icons_dir" != "true" ]]; then
    missing_required+=("icons/")
  fi

  index_tmp="$(mktemp)"
  tmp_files+=("$index_tmp")
  if unzip -p "$zip_path" index.html > "$index_tmp" 2>/dev/null; then
    if index_references_manifest "$index_tmp" && [[ "$has_manifest" != "true" ]]; then
      missing_required+=("manifest.json (referenced by index.html)")
    fi
  fi

  if [[ ${#missing_required[@]} -gt 0 ]]; then
    echo "Pages zip verification failed. Missing required runtime entries:" >&2
    for required in "${missing_required[@]}"; do
      echo " - $required" >&2
    done
    exit 1
  fi
fi

if [[ ${#offending_entries[@]} -gt 0 ]]; then
  if [[ "$mode" == "pages" ]]; then
    echo "Pages zip verification failed. Banned entries found:" >&2
  else
    echo "Release zip verification failed. Banned entries found:" >&2
  fi
  for entry in "${offending_entries[@]}"; do
    echo " - $entry" >&2
  done
  exit 1
fi

if [[ "$mode" == "pages" ]]; then
  echo "Pages zip is clean"
else
  echo "Release zip is clean"
fi
echo "$zip_path"
