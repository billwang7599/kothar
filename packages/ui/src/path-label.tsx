/**
 * A file path drawn to fit a narrow row: its folders are cut from the left first, so the file's name stays in view
 * ("…/browser/package.json"), and only then the name itself, from the right. No width is measured: CSS does the cutting,
 * so it fits whatever width the row has.
 */
export function splitPath(path: string): { dir: string; name: string } {
  const trimmed = path.replace(/\/+$/, '')
  const at = trimmed.lastIndexOf('/')
  return at < 0 ? { dir: '', name: trimmed } : { dir: trimmed.slice(0, at + 1), name: trimmed.slice(at + 1) }
}

// Marks that keep the folders' text left to right inside the right-to-left box that cuts it from the left.
const LRM = '\u200e'

export function PathLabel({ path, className = '' }: { path: string; className?: string }) {
  const { dir, name } = splitPath(path)
  return (
    <span className={`flex min-w-0 font-mono text-xs ${className}`} title={path} data-path>
      {dir && (
        <span className="min-w-0 shrink-[1000] truncate text-left text-muted [direction:rtl]" data-path-dir>
          {LRM + dir + LRM}
        </span>
      )}
      <span className="min-w-0 truncate" data-path-name>
        {name}
      </span>
    </span>
  )
}
