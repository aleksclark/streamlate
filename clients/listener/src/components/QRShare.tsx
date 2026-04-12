import React from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface QRShareProps {
  sessionId: string;
}

export function QRShare({ sessionId }: QRShareProps) {
  const url = typeof window !== 'undefined'
    ? `${window.location.origin}/listen/${sessionId}`
    : `/listen/${sessionId}`;

  return (
    <div className="text-center" data-testid="qr-share">
      <div className="bg-white p-3 rounded-lg inline-block">
        <QRCodeSVG value={url} size={128} />
      </div>
      <p className="text-xs text-gray-500 mt-2">Share with others</p>
    </div>
  );
}
