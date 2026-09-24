import React, { useState, useRef, useEffect } from 'react';
import {
  Image,
  ChevronRight,
  Maximize2,
  GitCompare,
  Clock,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import type { ScreenshotHistoryItem } from '../types';

interface ScreenshotSidebarProps {
  screenshots: ScreenshotHistoryItem[];
  isOpen: boolean;
  onToggle: () => void;
  onSelectMessage: (messageId: string) => void;
  onOpenDiff: (before: ScreenshotHistoryItem, after: ScreenshotHistoryItem) => void;
  onPreviewImage: (imageUrl: string) => void;
  onDeleteScreenshot?: (id: string) => void;
  onDeleteScreenshots?: (ids: string[]) => void;
  onPruneScreenshots?: (keepCount: number) => void;
  onClearAllScreenshots?: () => void;
}

export const ScreenshotSidebar: React.FC<ScreenshotSidebarProps> = ({
  screenshots,
  isOpen,
  onToggle,
  onSelectMessage,
  onOpenDiff,
  onPreviewImage,
  onDeleteScreenshot,
  onDeleteScreenshots,
  onPruneScreenshots,
  onClearAllScreenshots,
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    if (isMenuOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      return () => document.removeEventListener('mousedown', handleOutsideClick);
    }
  }, [isMenuOpen]);

  const handleToggleSelectForDiff = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((i) => i !== id);
      }
      return [...prev, id];
    });
  };

  const handleCompareSelected = () => {
    if (selectedIds.length !== 2) return;
    const item1 = screenshots.find((s) => s.id === selectedIds[0]);
    const item2 = screenshots.find((s) => s.id === selectedIds[1]);
    if (item1 && item2) {
      // Sort chronologically
      const [before, after] = item1.timestamp < item2.timestamp ? [item1, item2] : [item2, item1];
      onOpenDiff(before, after);
    }
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    if (confirm(`選択した ${selectedIds.length} 枚のスクショ画像を削除しますか？\n（テキスト履歴は保持されます）`)) {
      onDeleteScreenshots?.(selectedIds);
      setSelectedIds([]);
    }
  };

  return (
    <aside
      className={`border-l border-slate-800 bg-slate-900/90 backdrop-blur-md flex flex-col transition-all duration-300 z-10 shrink-0 select-none ${
        isOpen ? 'w-72 md:w-80' : 'w-12'
      }`}
    >
      {/* Header */}
      <div className="h-12 border-b border-slate-800/80 px-3 flex items-center justify-between">
        {isOpen ? (
          <>
            <div className="flex items-center gap-2 text-slate-200">
              <Image className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-semibold tracking-wide">
                画面キャプチャ履歴 ({screenshots.length})
              </span>
            </div>
            <div className="flex items-center gap-1">
              {screenshots.length > 0 && (
                <div className="relative" ref={menuRef}>
                  <button
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    className={`p-1.5 rounded-md transition ${
                      isMenuOpen
                        ? 'bg-slate-800 text-white ring-1 ring-slate-600'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                    title="スクショ履歴の整理・消去"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>

                  {isMenuOpen && (
                    <div className="absolute right-0 top-full mt-1.5 w-60 py-1 bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl z-50 text-xs backdrop-blur-xl">
                      <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 border-b border-slate-800">
                        スクショ整理・メモリ解放
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          if (confirm('最新 5 枚を残して古いスクショ画像を削除しますか？\n（テキスト履歴は保持されます）')) {
                            onPruneScreenshots?.(5);
                          }
                        }}
                        disabled={screenshots.length <= 5}
                        className="w-full text-left px-3 py-2 text-slate-200 hover:bg-slate-800 hover:text-white flex items-center justify-between disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer"
                      >
                        <span>最新 5 枚を残して削除</span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {screenshots.length > 5 ? `-${screenshots.length - 5}枚` : '0枚'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          if (confirm('最新 10 枚を残して古いスクショ画像を削除しますか？\n（テキスト履歴は保持されます）')) {
                            onPruneScreenshots?.(10);
                          }
                        }}
                        disabled={screenshots.length <= 10}
                        className="w-full text-left px-3 py-2 text-slate-200 hover:bg-slate-800 hover:text-white flex items-center justify-between disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer"
                      >
                        <span>最新 10 枚を残して削除</span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {screenshots.length > 10 ? `-${screenshots.length - 10}枚` : '0枚'}
                        </span>
                      </button>
                      <div className="border-t border-slate-800 my-1" />
                      <button
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          if (confirm('すべてのスクショ画像を消去しますか？\n（チャットのテキスト履歴は保持されます）')) {
                            onClearAllScreenshots?.();
                          }
                        }}
                        className="w-full text-left px-3 py-2 text-rose-400 hover:bg-rose-950/40 hover:text-rose-300 flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>すべての画像を削除 ({screenshots.length}枚)</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={onToggle}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
                title="サイドバーを閉じる"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </>
        ) : (
          <button
            onClick={onToggle}
            className="w-full flex items-center justify-center p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition relative"
            title="画面キャプチャ履歴を開く"
          >
            <Image className="w-4 h-4 text-blue-400" />
            {screenshots.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-blue-600 text-[9px] font-bold text-white flex items-center justify-center">
                {screenshots.length}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Main Content when Open */}
      {isOpen && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Action Bar if any selected */}
          {selectedIds.length > 0 && (
            <div className="p-2.5 bg-blue-950/40 border-b border-blue-900/50 flex items-center justify-between text-xs">
              <span className="text-blue-300 font-mono text-[11px]">
                {selectedIds.length} 枚選択中
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="text-slate-400 hover:text-slate-200 text-[11px] px-1 py-0.5"
                >
                  解除
                </button>
                {selectedIds.length === 2 && (
                  <button
                    type="button"
                    onClick={handleCompareSelected}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium text-[11px] shadow-sm transition"
                  >
                    <GitCompare className="w-3 h-3" />
                    <span>差分比較</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-rose-600/80 hover:bg-rose-500 text-white font-medium text-[11px] shadow-sm transition"
                  title="選択したスクショ画像を削除"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>削除</span>
                </button>
              </div>
            </div>
          )}

          {/* Screenshot List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {screenshots.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-2">
                <Image className="w-8 h-8 stroke-[1.5] text-slate-600" />
                <span className="text-xs">キャプチャ履歴がありません</span>
                <span className="text-[11px] text-slate-600">
                  AIが画面を取得するか、クイックボタンから撮影するとここに並びます
                </span>
              </div>
            ) : (
              screenshots.map((item, idx) => {
                const isSelected = selectedIds.includes(item.id);
                const prevItem = idx < screenshots.length - 1 ? screenshots[idx + 1] : null;

                return (
                  <div
                    key={item.id}
                    onClick={() => onSelectMessage(item.messageId)}
                    className={`group relative rounded-xl border p-2 bg-slate-950/60 hover:bg-slate-900/80 transition-all cursor-pointer shadow-md ${
                      isSelected
                        ? 'border-blue-500 ring-1 ring-blue-500/50'
                        : 'border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    {/* Thumbnail Image */}
                    <div className="relative aspect-video rounded-lg overflow-hidden bg-black/60 border border-slate-800">
                      <img
                        src={item.imageUrl}
                        alt="Capture thumbnail"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />

                      {/* Top Overlay controls */}
                      <div className="absolute top-1.5 left-1.5 right-1.5 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={(e) => handleToggleSelectForDiff(item.id, e)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono border backdrop-blur-md shadow-sm transition ${
                            isSelected
                              ? 'bg-blue-600 text-white border-blue-400'
                              : 'bg-slate-900/80 text-slate-200 border-slate-700 hover:bg-slate-800'
                          }`}
                          title="差分比較または一括削除用に選択"
                        >
                          {isSelected ? '✓ 選択中' : '+ 選択'}
                        </button>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onPreviewImage(item.imageUrl);
                            }}
                            className="p-1 rounded bg-slate-900/80 hover:bg-slate-800 text-white border border-slate-700 backdrop-blur-md shadow-sm"
                            title="拡大プレビュー"
                          >
                            <Maximize2 className="w-3 h-3" />
                          </button>
                          {onDeleteScreenshot && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteScreenshot(item.id);
                              }}
                              className="p-1 rounded bg-rose-950/80 hover:bg-rose-800 text-rose-200 border border-rose-700 backdrop-blur-md shadow-sm transition"
                              title="このスクショ画像を削除 (メモリ解放)"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Marker badge indicator if tool clicked */}
                      {item.marker && (
                        <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-700/80 text-rose-300 text-[9px] font-mono flex items-center gap-1 backdrop-blur-sm">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                          <span>Click ({Math.round(item.marker.x)}, {Math.round(item.marker.y)})</span>
                        </div>
                      )}
                    </div>

                    {/* Metadata & Jump link */}
                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                      <div className="flex items-center gap-1.5 truncate">
                        <Clock className="w-3 h-3 text-slate-500 shrink-0" />
                        <span className="font-mono">{new Date(item.timestamp).toLocaleTimeString()}</span>
                        <span className="text-[10px] text-slate-500">#{screenshots.length - idx}</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {prevItem && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenDiff(prevItem, item);
                            }}
                            className="text-[10px] text-blue-400 hover:text-blue-300 hover:underline"
                            title="直前のキャプチャと差分比較"
                          >
                            直前と比較
                          </button>
                        )}
                        <span className="text-slate-600">|</span>
                        <span className="text-slate-400 group-hover:text-blue-400 flex items-center gap-0.5 transition font-medium">
                          <span>会話へ</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
