#!/usr/bin/env bash
# 只保留 repo 根最新 N 份 `<name>-<version>.vsix`，其餘刪除。
#
#   ./scripts/prune-vsix.sh              # 保留 3 份
#   ./scripts/prune-vsix.sh --keep 5
#   ./scripts/prune-vsix.sh --dry-run    # 只列出會刪哪些，不刪
#
# 「最新」依版本號的 SemVer 排序，不依檔案時間：同版本重打包會覆寫同名檔，
# 而 0.1.10 要排在 0.1.9 之後，字串排序會排錯。
# 檔名不符 <name>-x.y.z.vsix 的一律不碰。
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

keep=3
dry_run=0
while [ $# -gt 0 ]; do
  case "$1" in
    --keep)
      [ $# -ge 2 ] && [[ "$2" =~ ^[0-9]+$ ]] || { echo "prune-vsix: --keep 後面要接非負整數" >&2; exit 1; }
      keep="$2"
      shift 2
      ;;
    --dry-run) dry_run=1; shift ;;
    *) echo "prune-vsix: 只接受 --keep N 與 --dry-run，收到 '$1'" >&2; exit 1 ;;
  esac
done

name="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync("package.json","utf8")).name));')"

versions=""
for file in "$root/$name"-*.vsix; do
  [ -e "$file" ] || continue
  version="${file##*/}"
  version="${version#"$name"-}"
  version="${version%.vsix}"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
  versions="${versions}${version}"$'\n'
done

total="$(printf '%s' "$versions" | grep -c . || true)"
remove=$(( total - keep ))
if [ "$remove" -le 0 ]; then
  echo "prune-vsix: 共 $total 份，保留 $keep 份，不需刪除"
  exit 0
fi

# 由小到大排，前面 remove 份就是要刪的。
printf '%s' "$versions" | sort -t . -k1,1n -k2,2n -k3,3n | head -n "$remove" | while IFS= read -r version; do
  target="$root/$name-$version.vsix"
  if [ "$dry_run" = "1" ]; then
    echo "prune-vsix: 會刪除 $(basename "$target")"
  else
    rm -f "$target"
    echo "prune-vsix: 已刪除 $(basename "$target")"
  fi
done
echo "prune-vsix: 共 $total 份，保留最新 $keep 份"
