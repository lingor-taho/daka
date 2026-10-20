import { ImagePlus, Link2, List, ListOrdered, Table2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export default function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const tableToolRef = useRef<HTMLDivElement>(null);
  const tableSelectionRef = useRef<Range | null>(null);
  const [uploading, setUploading] = useState(false);
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableColumns, setTableColumns] = useState(3);
  const [activeCell, setActiveCell] = useState<HTMLTableCellElement | null>(null);

  useEffect(() => {
    function updateActiveCell() {
      const selection = window.getSelection();
      const node = selection?.anchorNode;
      const element = node instanceof Element ? node : node?.parentElement;
      const cell = element?.closest<HTMLTableCellElement>("td, th") ?? null;
      setActiveCell(cell && editorRef.current?.contains(cell) ? cell : null);
    }
    document.addEventListener("selectionchange", updateActiveCell);
    return () => document.removeEventListener("selectionchange", updateActiveCell);
  }, []);

  useEffect(() => {
    if (!tablePickerOpen) return;
    function closeOnOutsideClick(event: PointerEvent) {
      if (!tableToolRef.current?.contains(event.target as Node)) setTablePickerOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setTablePickerOpen(false);
        tableToolRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [tablePickerOpen]);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  function command(name: string, commandValue?: string) {
    editorRef.current?.focus();
    document.execCommand(name, false, commandValue);
    onChange(editorRef.current?.innerHTML ?? "");
  }

  function insertTable(rows: number, columns: number) {
    if (!Number.isInteger(rows) || rows < 1 || rows > 50 ||
        !Number.isInteger(columns) || columns < 1 || columns > 20) return;
    editorRef.current?.focus();
    const selection = window.getSelection();
    const range = tableSelectionRef.current;
    if (selection && range && editorRef.current?.contains(range.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const body = Array.from({ length: rows }, (_, row) => {
      const tag = row === 0 ? "th" : "td";
      return `<tr>${Array.from({ length: columns }, () =>
        `<${tag} style="border:1px solid #ccd8d4;padding:8px"><br></${tag}>`
      ).join("")}</tr>`;
    }).join("");
    command("insertHTML", `<table style="width:100%;border-collapse:collapse"><tbody>${body}</tbody></table><p><br></p>`);
    setTablePickerOpen(false);
  }

  function extendTable(direction: "above" | "below" | "left" | "right") {
    const cell = activeCell;
    const table = cell?.closest("table");
    if (!cell || !table || !editorRef.current?.contains(table)) return;
    const rows = Array.from(table.rows);
    // Map visual columns as well as DOM cell indexes, including pasted merged cells.
    const grid: HTMLTableCellElement[][] = rows.map(() => []);
    const positions = new Map<HTMLTableCellElement, { row: number; column: number }>();
    rows.forEach((row, rowIndex) => {
      let column = 0;
      Array.from(row.cells).forEach((item) => {
        while (grid[rowIndex][column]) column++;
        positions.set(item, { row: rowIndex, column });
        const height = item.rowSpan || rows.length - rowIndex;
        for (let r = rowIndex; r < Math.min(rows.length, rowIndex + height); r++) {
          for (let c = column; c < column + item.colSpan; c++) grid[r][c] = item;
        }
        column += item.colSpan;
      });
    });
    const position = positions.get(cell);
    if (!position) return;
    function emptyCell(tag: string) {
      const next = document.createElement(tag) as HTMLTableCellElement;
      next.style.cssText = "border:1px solid #ccd8d4;padding:8px";
      next.innerHTML = "<br>";
      return next;
    }
    let focusCell: HTMLTableCellElement | undefined;
    if (direction === "above" || direction === "below") {
      const index = position.row + (direction === "below" ? 1 : 0);
      const nextRow = document.createElement("tr");
      const width = Math.max(...grid.map((row) => row.length));
      const expanded = new Set<HTMLTableCellElement>();
      for (let column = 0; column < width; column++) {
        const previous = grid[index - 1]?.[column];
        const origin = previous && positions.get(previous);
        if (previous && origin && (previous.rowSpan === 0 || origin.row + previous.rowSpan > index)) {
          if (!expanded.has(previous)) {
            if (previous.rowSpan !== 0) previous.rowSpan++;
            expanded.add(previous);
          }
        } else {
          const next = emptyCell(direction === "above" && rows[position.row].cells[0]?.tagName === "TH" ? "th" : "td");
          nextRow.append(next);
          focusCell ??= next;
        }
      }
      const reference = rows[position.row];
      reference.parentElement?.insertBefore(nextRow, direction === "above" ? reference : reference.nextSibling);
    } else {
      const index = position.column + (direction === "right" ? cell.colSpan : 0);
      const expanded = new Set<HTMLTableCellElement>();
      rows.forEach((row, rowIndex) => {
        const previous = grid[rowIndex][index - 1];
        const origin = previous && positions.get(previous);
        if (previous && origin && origin.column + previous.colSpan > index) {
          if (!expanded.has(previous)) {
            previous.colSpan++;
            expanded.add(previous);
          }
          return;
        }
        const reference = Array.from(row.cells).find((item) => positions.get(item)!.column >= index);
        const next = emptyCell(row.cells[0]?.tagName === "TH" ? "th" : "td");
        row.insertBefore(next, reference ?? null);
        if (rowIndex === position.row) focusCell = next;
      });
    }
    editorRef.current.focus();
    const target = focusCell ?? cell;
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    setActiveCell(target);
    onChange(editorRef.current.innerHTML);
  }

  async function uploadImage(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("image", file);
      const result = await api<{ url: string }>("/api/admin/upload-image", {
        method: "POST",
        body
      });
      command(
        "insertHTML",
        `<img src="${result.url}" alt="${file.name.replaceAll('"', "")}" style="max-width:100%;height:auto;border-radius:10px" />`
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="rich-editor">
      <div className="rich-toolbar" aria-label="富文本工具栏">
        <button type="button" onClick={() => command("bold")} title="加粗">
          <strong>B</strong>
        </button>
        <button type="button" onClick={() => command("italic")} title="斜体">
          <em>I</em>
        </button>
        <button type="button" onClick={() => command("underline")} title="下划线">
          <u>U</u>
        </button>
        <button type="button" onClick={() => command("insertUnorderedList")} title="无序列表">
          <List size={16} />
        </button>
        <button type="button" onClick={() => command("insertOrderedList")} title="有序列表">
          <ListOrdered size={16} />
        </button>
        <label className="color-tool" title="文字颜色">
          <input
            type="color"
            defaultValue="#17312c"
            onChange={(event) => command("foreColor", event.target.value)}
          />
        </label>
        <select
          aria-label="字号"
          defaultValue="3"
          onChange={(event) => command("fontSize", event.target.value)}
        >
          <option value="2">小</option>
          <option value="3">正文</option>
          <option value="4">大</option>
          <option value="5">标题</option>
        </select>
        <button
          type="button"
          onClick={() => {
            const url = window.prompt("请输入链接地址");
            if (url) command("createLink", url);
          }}
          title="插入链接"
        >
          <Link2 size={16} />
        </button>
        <div className="table-tool" ref={tableToolRef}>
          <button
            type="button"
            title="插入表格"
            aria-label="插入表格"
            aria-expanded={tablePickerOpen}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (!tablePickerOpen) {
                const selection = window.getSelection();
                const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
                tableSelectionRef.current = range && editorRef.current?.contains(range.commonAncestorContainer)
                  ? range.cloneRange() : null;
              }
              setTablePickerOpen(!tablePickerOpen);
            }}
          >
            <Table2 size={16} />
          </button>
          {tablePickerOpen && (
            <div className="table-picker" role="group" aria-label="选择表格行列">
              <div className="table-picker-size" aria-live="polite">{tableRows || 0} 行 × {tableColumns || 0} 列</div>
              <div className="table-picker-grid">
                {Array.from({ length: 80 }, (_, index) => {
                  const rows = Math.floor(index / 10) + 1;
                  const columns = index % 10 + 1;
                  return <button
                    key={index}
                    type="button"
                    className={rows <= tableRows && columns <= tableColumns ? "is-selected" : ""}
                    aria-label={`${rows} 行 ${columns} 列`}
                    onMouseEnter={() => { setTableRows(rows); setTableColumns(columns); }}
                    onFocus={() => { setTableRows(rows); setTableColumns(columns); }}
                    onClick={() => insertTable(rows, columns)}
                  />;
                })}
              </div>
              <div className="table-picker-inputs">
                <label>行数<input type="number" min="1" max="50" step="1" value={tableRows || ""}
                  onChange={(event) => setTableRows(Number(event.target.value))} /></label>
                <label>列数<input type="number" min="1" max="20" step="1" value={tableColumns || ""}
                  onChange={(event) => setTableColumns(Number(event.target.value))} /></label>
              </div>
              <p className="table-picker-hint">最多 50 行、20 列，首行为表头</p>
              <button type="button" className="table-picker-insert"
                disabled={!Number.isInteger(tableRows) || tableRows < 1 || tableRows > 50 ||
                  !Number.isInteger(tableColumns) || tableColumns < 1 || tableColumns > 20}
                onClick={() => insertTable(tableRows, tableColumns)}>插入表格</button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          title="上传图片"
          disabled={uploading}
        >
          <ImagePlus size={16} />
          {uploading ? "上传中" : "图片"}
        </button>
        <input
          ref={imageInputRef}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadImage(file);
            event.target.value = "";
          }}
        />
        {activeCell && (
          <div className="table-edit-tools" role="group" aria-label="追加表格行列">
            <span>表格</span>
            {([
              ["above", "上方插行"], ["below", "下方插行"],
              ["left", "左侧插列"], ["right", "右侧插列"]
            ] as const).map(([direction, label]) => (
              <button type="button" key={direction}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => extendTable(direction)}>{label}</button>
            ))}
          </div>
        )}
      </div>
      <div
        ref={editorRef}
        className="rich-content"
        contentEditable
        suppressContentEditableWarning
        data-placeholder="输入任务详细说明，可直接粘贴截图…"
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
        onPaste={(event) => {
          const image = [...event.clipboardData.items]
            .find((item) => item.type.startsWith("image/"))
            ?.getAsFile();
          if (image) {
            event.preventDefault();
            void uploadImage(image);
          }
        }}
      />
    </div>
  );
}

