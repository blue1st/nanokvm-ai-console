import React, { useState, useRef } from 'react';
import { Maximize2, Layers, Crosshair, Send } from 'lucide-react';

interface VisualOverlayImageProps {
  src: string;
  alt?: string;
  marker?: {
    x: number;
    y: number;
    label?: string;
  };
  className?: string;
  imageClassName?: string;
  onPreview?: () => void;
  showOverlayToggle?: boolean;
  onPickCoordinates?: (coords: { x: number; y: number }) => void;
}

export const VisualOverlayImage: React.FC<VisualOverlayImageProps> = ({
  src,
  alt = 'NanoKVM Capture',
  marker,
  className = '',
  imageClassName,
  onPreview,
  showOverlayToggle = true,
  onPickCoordinates,
}) => {
  const [showMarker, setShowMarker] = useState(true);
  const [isPickerActive, setIsPickerActive] = useState(false);
  const [pickedCoord, setPickedCoord] = useState<{ x: number; y: number } | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.currentTarget;
    setImageSize({
      width: target.naturalWidth,
      height: target.naturalHeight,
    });
  };

  // Calculate percentage coordinates if marker is provided
  let markerStyle: React.CSSProperties | null = null;
  if (marker && imageSize && imageSize.width > 0 && imageSize.height > 0) {
    const leftPercent = Math.min(100, Math.max(0, (marker.x / imageSize.width) * 100));
    const topPercent = Math.min(100, Math.max(0, (marker.y / imageSize.height) * 100));
    markerStyle = {
      left: `${leftPercent}%`,
      top: `${topPercent}%`,
    };
  } else if (marker && marker.x <= 1 && marker.y <= 1) {
    markerStyle = {
      left: `${marker.x * 100}%`,
      top: `${marker.y * 100}%`,
    };
  }

  // Handle click on image for visual coordinate picking
  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!isPickerActive || !imgRef.current || !imageSize) return;

    const rect = imgRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const scaleX = imageSize.width / rect.width;
    const scaleY = imageSize.height / rect.height;

    const realX = Math.round(clickX * scaleX);
    const realY = Math.round(clickY * scaleY);

    setPickedCoord({ x: realX, y: realY });
  };

  return (
    <div
      className={`relative group inline-block select-none overflow-hidden rounded-lg border border-slate-800 bg-slate-950 ${className}`}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onLoad={handleImageLoad}
        onClick={handleImageClick}
        className={`${
          imageClassName || 'max-h-64 md:max-h-72 w-auto object-contain block'
        } ${isPickerActive ? 'cursor-crosshair' : ''}`}
      />

      {/* AI Action Marker Overlay */}
      {marker && markerStyle && showMarker && (
        <div
          style={markerStyle}
          className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10 flex flex-col items-center"
        >
          {/* Ripple animation */}
          <span className="absolute w-8 h-8 rounded-full bg-rose-500/40 animate-ping" />

          {/* Crosshair target */}
          <div className="relative w-6 h-6 rounded-full border-2 border-rose-500 bg-rose-500/20 shadow-lg shadow-rose-500/50 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-rose-400 shadow-sm" />
            <span className="absolute w-4 h-0.5 bg-rose-500/80 -top-1" />
            <span className="absolute w-4 h-0.5 bg-rose-500/80 -bottom-1" />
            <span className="absolute w-0.5 h-4 bg-rose-500/80 -left-1" />
            <span className="absolute w-0.5 h-4 bg-rose-500/80 -right-1" />
          </div>

          {/* Coordinate label tag */}
          <div className="mt-1 px-1.5 py-0.5 rounded bg-slate-900/90 border border-rose-500/60 text-[10px] font-mono text-rose-200 whitespace-nowrap shadow-md">
            {marker.label || `(${Math.round(marker.x)}, ${Math.round(marker.y)})`}
          </div>
        </div>
      )}

      {/* User Picked Coordinate Marker */}
      {pickedCoord && imageSize && (
        <div
          style={{
            left: `${(pickedCoord.x / imageSize.width) * 100}%`,
            top: `${(pickedCoord.y / imageSize.height) * 100}%`,
          }}
          className="absolute -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center"
        >
          <div className="w-5 h-5 rounded-full border-2 border-blue-400 bg-blue-500/30 shadow-lg shadow-blue-500/60 flex items-center justify-center animate-pulse">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-300" />
          </div>
          <div className="mt-1 px-2 py-0.5 rounded-md bg-blue-950/95 border border-blue-500/80 text-[11px] font-mono text-blue-200 shadow-xl flex items-center gap-1.5 whitespace-nowrap">
            <span>({pickedCoord.x}, {pickedCoord.y})</span>
            {onPickCoordinates && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPickCoordinates(pickedCoord);
                  setPickedCoord(null);
                  setIsPickerActive(false);
                }}
                className="px-1.5 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-sans text-[10px] flex items-center gap-1 shadow-sm cursor-pointer"
              >
                <Send className="w-2.5 h-2.5" />
                <span>指示に挿入</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Control Buttons (Hover or Top Right) */}
      <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-30">
        {onPickCoordinates && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsPickerActive(!isPickerActive);
              if (isPickerActive) setPickedCoord(null);
            }}
            className={`p-1.5 rounded-md backdrop-blur-md border text-xs transition shadow-md cursor-pointer ${
              isPickerActive
                ? 'bg-blue-600 border-blue-400 text-white ring-2 ring-blue-400/50'
                : 'bg-slate-900/80 border-slate-700 text-slate-300 hover:text-white'
            }`}
            title={isPickerActive ? '座標ピッカーを終了' : '画像クリックで座標を指定 (Visual Prompting)'}
          >
            <Crosshair className="w-3.5 h-3.5" />
          </button>
        )}

        {marker && showOverlayToggle && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowMarker(!showMarker);
            }}
            className={`p-1.5 rounded-md backdrop-blur-md border text-xs transition shadow-md cursor-pointer ${
              showMarker
                ? 'bg-rose-950/80 border-rose-700/80 text-rose-200'
                : 'bg-slate-900/80 border-slate-700 text-slate-300 hover:text-white'
            }`}
            title={showMarker ? 'AI操作マーカーを非表示' : 'AI操作マーカーを表示'}
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
        )}

        {onPreview && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPreview();
            }}
            className="p-1.5 rounded-md bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-slate-700 backdrop-blur-md text-xs transition shadow-md cursor-pointer"
            title="拡大表示"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Resolution info badge or Picker notice */}
      {isPickerActive ? (
        <div className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded bg-blue-900/90 backdrop-blur-sm border border-blue-600 text-[10px] font-medium text-blue-200 animate-pulse">
          🎯 クリックした箇所の座標を取得します
        </div>
      ) : imageSize ? (
        <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-slate-950/70 backdrop-blur-sm border border-slate-800 text-[9px] font-mono text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
          {imageSize.width} × {imageSize.height}
        </div>
      ) : null}
    </div>
  );
};
