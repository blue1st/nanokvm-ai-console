import React, { useState } from 'react';
import { X, ArrowLeftRight, Columns } from 'lucide-react';
import type { ScreenshotHistoryItem } from '../types';

interface DiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  beforeItem: ScreenshotHistoryItem | null;
  afterItem: ScreenshotHistoryItem | null;
}

export const DiffModal: React.FC<DiffModalProps> = ({
  isOpen,
  onClose,
  beforeItem,
  afterItem,
}) => {
  const [sliderPos, setSliderPos] = useState(50);
  const [mode, setMode] = useState<'slider' | 'side-by-side'>('slider');

  if (!isOpen || !beforeItem || !afterItem) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-2 md:p-3 select-none"
      onClick={onClose}
    >
      <div
        className="relative w-[98vw] h-[96vh] max-w-[1920px] bg-slate-900 border border-slate-700/80 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-slate-800 bg-slate-950/90 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-white">画面差分・比較 (Diff View)</span>
            <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700/60">
              <button
                type="button"
                onClick={() => setMode('slider')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition cursor-pointer ${
                  mode === 'slider'
                    ? 'bg-blue-600 text-white font-medium shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span>スライダー</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('side-by-side')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition cursor-pointer ${
                  mode === 'side-by-side'
                    ? 'bg-blue-600 text-white font-medium shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Columns className="w-3.5 h-3.5" />
                <span>並列 (2画面)</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-400 flex items-center gap-2">
              <span className="text-blue-400">Before: {new Date(beforeItem.timestamp).toLocaleTimeString()}</span>
              <span>→</span>
              <span className="text-emerald-400">After: {new Date(afterItem.timestamp).toLocaleTimeString()}</span>
            </div>
            <span className="text-[10px] text-slate-400 bg-slate-800/80 border border-slate-700 px-2 py-0.5 rounded-full font-mono">
              Esc で閉じる
            </span>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-2 md:p-4 overflow-hidden flex items-center justify-center bg-slate-950 min-h-0 relative">
          {mode === 'side-by-side' ? (
            <div className="grid grid-cols-2 gap-3 w-full h-full">
              <div className="flex flex-col items-center justify-center gap-1.5 bg-slate-900/50 rounded-xl p-2 border border-slate-800 min-h-0 overflow-hidden">
                <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider shrink-0">Before</span>
                <div className="flex-1 w-full h-full flex items-center justify-center min-h-0 overflow-hidden">
                  <img
                    src={beforeItem.imageUrl}
                    alt="Before capture"
                    className="max-h-[calc(96vh-8rem)] max-w-full w-auto h-auto object-contain rounded-lg border border-slate-800"
                  />
                </div>
              </div>
              <div className="flex flex-col items-center justify-center gap-1.5 bg-slate-900/50 rounded-xl p-2 border border-slate-800 min-h-0 overflow-hidden">
                <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider shrink-0">After</span>
                <div className="flex-1 w-full h-full flex items-center justify-center min-h-0 overflow-hidden">
                  <img
                    src={afterItem.imageUrl}
                    alt="After capture"
                    className="max-h-[calc(96vh-8rem)] max-w-full w-auto h-auto object-contain rounded-lg border border-slate-800"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="relative max-h-[calc(96vh-6rem)] max-w-full inline-block select-none overflow-hidden rounded-xl border border-slate-800">
              {/* After image (Base) */}
              <img
                src={afterItem.imageUrl}
                alt="After"
                className="max-h-[calc(96vh-6rem)] max-w-full w-auto h-auto object-contain block pointer-events-none"
              />

              {/* Before image (Clipped by slider) */}
              <div
                className="absolute inset-0 overflow-hidden pointer-events-none"
                style={{ width: `${sliderPos}%` }}
              >
                <img
                  src={beforeItem.imageUrl}
                  alt="Before"
                  className="max-h-[calc(96vh-6rem)] max-w-none w-auto h-auto object-contain block"
                />
              </div>

              {/* Slider divider line */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)] pointer-events-none"
                style={{ left: `${sliderPos}%` }}
              >
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-lg border-2 border-white pointer-events-none">
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                </div>
              </div>

              {/* Interactive range slider overlay */}
              <input
                type="range"
                min="0"
                max="100"
                value={sliderPos}
                onChange={(e) => setSliderPos(Number(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-20"
              />

              {/* Badge Labels */}
              <div className="absolute bottom-3 left-3 px-2 py-1 rounded bg-black/60 backdrop-blur-md text-[11px] font-mono text-blue-300 border border-blue-500/40 pointer-events-none">
                Before ({sliderPos}%)
              </div>
              <div className="absolute bottom-3 right-3 px-2 py-1 rounded bg-black/60 backdrop-blur-md text-[11px] font-mono text-emerald-300 border border-emerald-500/40 pointer-events-none">
                After ({100 - sliderPos}%)
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
