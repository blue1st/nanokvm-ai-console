import React, { useState, useRef } from 'react';
import {
  Maximize2,
  Minimize2,
  RotateCw,
  ExternalLink,
  X,
  Radio,
  Lock,
} from 'lucide-react';

interface LiveViewPanelProps {
  isOpen: boolean;
  onClose: () => void;
  endpoint: string;
}

export const LiveViewPanel: React.FC<LiveViewPanelProps> = ({
  isOpen,
  onClose,
  endpoint,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [key, setKey] = useState(0); // for reload
  const [width, setWidth] = useState(520);
  const isResizingRef = useRef(false);

  if (!isOpen) return null;

  // Calculate WebKVM root URL from MCP endpoint
  // e.g. https://192.168.1.45/api/mcp -> https://192.168.1.45/#/
  let webUrl = 'https://192.168.1.45/#/';
  try {
    if (endpoint) {
      const parsed = new URL(endpoint);
      webUrl = `${parsed.protocol}//${parsed.host}/#/`;
    }
  } catch {
    // fallback
  }

  const handleOpenExternal = () => {
    if (window.api?.openExternal) {
      window.api.openExternal(webUrl);
    } else {
      window.open(webUrl, '_blank');
    }
  };

  const handleReload = () => {
    setKey((prev) => prev + 1);
  };

  const handleMouseDownResize = (e: React.MouseEvent) => {
    isResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return;
      const deltaX = startX - moveEvent.clientX;
      const newWidth = Math.max(380, Math.min(window.innerWidth - 300, startWidth + deltaX));
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizingRef.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div
      style={{ width: isExpanded ? '100%' : `${width}px` }}
      className={`relative h-full flex flex-col border-l border-slate-800 bg-slate-950 shadow-2xl z-20 transition-[width] duration-150 select-none ${
        isExpanded ? 'fixed inset-y-0 right-0 z-40' : ''
      }`}
    >
      {/* Resizer Handle on Left Edge (only when not expanded) */}
      {!isExpanded && (
        <div
          onMouseDown={handleMouseDownResize}
          className="absolute top-0 bottom-0 -left-1.5 w-3 cursor-ew-resize hover:bg-blue-500/40 z-30 transition-colors"
          title="ドラッグして幅をリサイズ"
        />
      )}

      {/* Panel Header */}
      <div className="h-12 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md px-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/60 text-emerald-400 text-xs">
            <Radio className="w-3 h-3 animate-pulse" />
            <span className="font-semibold text-[11px] tracking-wide">Live WebKVM</span>
          </div>
          <span className="text-[11px] text-slate-400 font-mono hidden sm:inline truncate max-w-[180px]">
            {webUrl}
          </span>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleReload}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="再読み込み"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleOpenExternal}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="ブラウザで開く"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title={isExpanded ? '通常サイズに戻す' : '最大化'}
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="閉じる"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Webview / iframe Embed */}
      <div className="flex-1 w-full h-full relative bg-black overflow-hidden flex flex-col">
        {/* We use webview tag in Electron */}
        <webview
          key={key}
          src={webUrl}
          allowpopups={true}
          className="w-full flex-1 border-none"
          style={{ width: '100%', height: '100%' }}
        />

        {/* Footer Helper Notice */}
        <div className="h-6 bg-slate-900 border-t border-slate-800 px-3 flex items-center justify-between text-[10px] text-slate-400 shrink-0">
          <span className="flex items-center gap-1">
            <Lock className="w-2.5 h-2.5 text-emerald-400" />
            <span>直接マウス・キーボード操作可能 (自己署名TLS自動承認)</span>
          </span>
          <span className="text-slate-500 font-mono">NanoKVM MJPEG/WebRTC Stream</span>
        </div>
      </div>
    </div>
  );
};
