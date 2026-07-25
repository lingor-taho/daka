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
  const [uploading, setUploading] = useState(false);

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
        <button
          type="button"
          onClick={() =>
            command(
              "insertHTML",
              '<table style="width:100%;border-collapse:collapse"><tbody><tr><th style="border:1px solid #ccd8d4;padding:8px">标题</th><th style="border:1px solid #ccd8d4;padding:8px">标题</th></tr><tr><td style="border:1px solid #ccd8d4;padding:8px">内容</td><td style="border:1px solid #ccd8d4;padding:8px">内容</td></tr></tbody></table><p><br></p>'
            )
          }
          title="插入表格"
        >
          <Table2 size={16} />
        </button>
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

