import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import QRCode from 'qrcode';
import { Download, Upload, Trash2, QrCode } from 'lucide-react';

// --- Reusable inline style constants ---
const STYLES = {
  colorPickerInput: { width: '45px', height: '40px', padding: '2px', cursor: 'pointer' },
  colorHexInput: { fontSize: '0.85rem' },
  sectionHeading: { fontSize: '1.1rem', fontWeight: 600, marginBottom: '14px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' },
  twoColGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' },
  noMarginBottom: { marginBottom: 0 },
};

const drawFinderPattern = (ctx, startRow, startCol, moduleSize, margin, fgColor, bgColor, transparentBg, eyeShape) => {
  const x = (startCol + margin) * moduleSize;
  const y = (startRow + margin) * moduleSize;
  
  // Outer frame size is 7 modules
  const outerSize = 7 * moduleSize;
  // Inner space size is 5 modules
  const innerSpaceSize = 5 * moduleSize;
  const innerSpaceOffset = 1 * moduleSize;
  // Center dot size is 3 modules
  const centerSize = 3 * moduleSize;
  const centerOffset = 2 * moduleSize;
  
  ctx.fillStyle = fgColor;
  
  if (eyeShape === 'circle') {
    // Circle outer frame
    ctx.beginPath();
    ctx.arc(x + outerSize / 2, y + outerSize / 2, outerSize / 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Clear/fill inner space
    ctx.fillStyle = transparentBg ? '#ffffff' : bgColor;
    ctx.save();
    if (transparentBg) {
      ctx.globalCompositeOperation = 'destination-out';
    }
    ctx.beginPath();
    ctx.arc(x + outerSize / 2, y + outerSize / 2, innerSpaceSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    
    // Draw center dot
    ctx.fillStyle = fgColor;
    ctx.beginPath();
    ctx.arc(x + outerSize / 2, y + outerSize / 2, centerSize / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (eyeShape === 'rounded') {
    // Rounded outer frame
    ctx.beginPath();
    ctx.roundRect(x, y, outerSize, outerSize, outerSize * 0.25);
    ctx.fill();
    
    // Clear/fill inner space
    ctx.fillStyle = transparentBg ? '#ffffff' : bgColor;
    ctx.save();
    if (transparentBg) {
      ctx.globalCompositeOperation = 'destination-out';
    }
    ctx.beginPath();
    ctx.roundRect(x + innerSpaceOffset, y + innerSpaceOffset, innerSpaceSize, innerSpaceSize, innerSpaceSize * 0.25);
    ctx.fill();
    ctx.restore();
    
    // Draw center dot (with increased roundness 0.4 to follow the frame)
    ctx.fillStyle = fgColor;
    ctx.beginPath();
    ctx.roundRect(x + centerOffset, y + centerOffset, centerSize, centerSize, centerSize * 0.4);
    ctx.fill();
  } else if (eyeShape === 'diamond') {
    // Diamond outer frame
    ctx.beginPath();
    ctx.moveTo(x + outerSize / 2, y);
    ctx.lineTo(x + outerSize, y + outerSize / 2);
    ctx.lineTo(x + outerSize / 2, y + outerSize);
    ctx.lineTo(x, y + outerSize / 2);
    ctx.closePath();
    ctx.fill();
    
    // Clear/fill inner space
    ctx.fillStyle = transparentBg ? '#ffffff' : bgColor;
    ctx.save();
    if (transparentBg) {
      ctx.globalCompositeOperation = 'destination-out';
    }
    ctx.beginPath();
    ctx.moveTo(x + outerSize / 2, y + innerSpaceOffset);
    ctx.lineTo(x + outerSize - innerSpaceOffset, y + outerSize / 2);
    ctx.lineTo(x + outerSize / 2, y + outerSize - innerSpaceOffset);
    ctx.lineTo(x + innerSpaceOffset, y + outerSize / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    
    // Draw center dot (Diamond center)
    ctx.fillStyle = fgColor;
    ctx.beginPath();
    ctx.moveTo(x + outerSize / 2, y + centerOffset);
    ctx.lineTo(x + outerSize - centerOffset, y + outerSize / 2);
    ctx.lineTo(x + outerSize / 2, y + outerSize - centerOffset);
    ctx.lineTo(x + centerOffset, y + outerSize / 2);
    ctx.closePath();
    ctx.fill();
  } else {
    // Default: Square
    // Outer frame
    ctx.fillRect(x, y, outerSize, outerSize);
    
    // Clear/fill inner space
    ctx.fillStyle = transparentBg ? '#ffffff' : bgColor;
    ctx.save();
    if (transparentBg) {
      ctx.globalCompositeOperation = 'destination-out';
    }
    ctx.fillRect(x + innerSpaceOffset, y + innerSpaceOffset, innerSpaceSize, innerSpaceSize);
    ctx.restore();
    
    // Draw center dot
    ctx.fillStyle = fgColor;
    ctx.fillRect(x + centerOffset, y + centerOffset, centerSize, centerSize);
  }
};

/**
 * Build SVG string using array-based accumulation (O(n)) instead of string += concatenation (O(n^2)).
 */
const buildSVGString = (qrData, fgColor, bgColor, bgType, qrShape, eyeShape, logoPreview, logoSize, logoBgMode) => {
  const numModules = qrData.modules.size;
  const margin = 2;
  const totalModules = numModules + margin * 2;
  
  // Use array accumulation for O(n) string building
  const parts = [];
  
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalModules} ${totalModules}" shape-rendering="crispEdges">\n`);
  
  // Generate defs if needed
  const hasDefs = bgType === 'transparent-full' || (bgType === 'transparent-margin' && logoPreview && logoBgMode === 'transparent');
  if (hasDefs) {
    parts.push('  <defs>\n');
    
    if (bgType === 'transparent-full') {
      const eyePositions = [
        { id: 'eye-tl', x: margin, y: margin },
        { id: 'eye-tr', x: numModules - 7 + margin, y: margin },
        { id: 'eye-bl', x: margin, y: numModules - 7 + margin }
      ];
      
      eyePositions.forEach(pos => {
        if (eyeShape === 'circle') {
          parts.push(`    <mask id="mask-${pos.id}">
        <rect width="${totalModules}" height="${totalModules}" fill="white" />
        <circle cx="${pos.x + 3.5}" cy="${pos.y + 3.5}" r="3.5" fill="white" />
        <circle cx="${pos.x + 3.5}" cy="${pos.y + 3.5}" r="2.5" fill="black" />
      </mask>\n`);
        } else if (eyeShape === 'rounded') {
          parts.push(`    <mask id="mask-${pos.id}">
        <rect width="${totalModules}" height="${totalModules}" fill="white" />
        <rect x="${pos.x}" y="${pos.y}" width="7" height="7" rx="1.75" ry="1.75" fill="white" />
        <rect x="${pos.x + 1}" y="${pos.y + 1}" width="5" height="5" rx="1.25" ry="1.25" fill="black" />
      </mask>\n`);
        } else if (eyeShape === 'diamond') {
          parts.push(`    <mask id="mask-${pos.id}">
        <rect width="${totalModules}" height="${totalModules}" fill="white" />
        <path d="M ${pos.x + 3.5} ${pos.y} L ${pos.x + 7} ${pos.y + 3.5} L ${pos.x + 3.5} ${pos.y + 7} L ${pos.x} ${pos.y + 3.5} Z M ${pos.x + 3.5} ${pos.y + 1} L ${pos.x + 6} ${pos.y + 3.5} L ${pos.x + 3.5} ${pos.y + 6} L ${pos.x + 1} ${pos.y + 3.5} Z" fill="black" fill-rule="evenodd" />
      </mask>\n`);
        } else {
          parts.push(`    <mask id="mask-${pos.id}">
        <rect width="${totalModules}" height="${totalModules}" fill="white" />
        <rect x="${pos.x}" y="${pos.y}" width="7" height="7" fill="white" />
        <rect x="${pos.x + 1}" y="${pos.y + 1}" width="5" height="5" fill="black" />
      </mask>\n`);
        }
      });
    }
    
    // Mask for logo cutout if logo is present and logoBgMode is transparent
    if (logoPreview && logoBgMode === 'transparent') {
      const size = (totalModules * logoSize) / 100;
      const x = (totalModules - size) / 2;
      const y = (totalModules - size) / 2;
      const bgPadding = size * 0.15;
      
      parts.push(`    <mask id="logo-cutout-mask">
      <rect width="${totalModules}" height="${totalModules}" fill="white" />
      <rect x="${x - bgPadding}" y="${y - bgPadding}" width="${size + bgPadding * 2}" height="${size + bgPadding * 2}" rx="${size * 0.2}" ry="${size * 0.2}" fill="black" />
    </mask>\n`);
    }
    
    parts.push('  </defs>\n');
  }
  
  // Draw background based on type
  if (bgType === 'solid') {
    parts.push(`  <rect width="${totalModules}" height="${totalModules}" fill="${bgColor}" />\n`);
  } else if (bgType === 'transparent-margin') {
    const bgMaskAttr = (logoPreview && logoBgMode === 'transparent') ? ' mask="url(#logo-cutout-mask)"' : '';
    parts.push(`  <rect x="${margin}" y="${margin}" width="${numModules}" height="${numModules}" fill="${bgColor}"${bgMaskAttr} />\n`);
  }
  
  // Begin body modules group
  const isTransparent = bgType !== 'solid';
  const bodyMaskAttr = (isTransparent && logoPreview && logoBgMode === 'transparent') ? ' mask="url(#logo-cutout-mask)"' : '';
  parts.push(`  <g id="body-modules" fill="${fgColor}"${bodyMaskAttr}>\n`);
  
  for (let r = 0; r < numModules; r++) {
    for (let c = 0; c < numModules; c++) {
      const isDark = qrData.modules.data[r * numModules + c] === 1;
      if (!isDark) continue;
      
      // Skip finder pattern modules
      const isFinder = (r < 7 && c < 7) || (r < 7 && c >= numModules - 7) || (r >= numModules - 7 && c < 7);
      if (isFinder) continue;
      
      const x = c + margin;
      const y = r + margin;
      
      if (qrShape === 'circle') {
        parts.push(`    <circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.44" />\n`);
      } else if (qrShape === 'rounded') {
        parts.push(`    <rect x="${x + 0.05}" y="${y + 0.05}" width="0.9" height="0.9" rx="0.2" ry="0.2" />\n`);
      } else if (qrShape === 'diamond') {
        parts.push(`    <path d="M ${x + 0.5} ${y + 0.05} L ${x + 0.95} ${y + 0.5} L ${x + 0.5} ${y + 0.95} L ${x + 0.05} ${y + 0.5} Z" />\n`);
      } else {
        // square
        parts.push(`    <rect x="${x}" y="${y}" width="1" height="1" />\n`);
      }
    }
  }
  parts.push('  </g>\n');
  
  // Helper function to write eye SVG tags
  const writeEye = (id, startRow, startCol) => {
    const x = startCol + margin;
    const y = startRow + margin;
    
    if (bgType === 'transparent-full') {
      // Use mask for outer frame
      if (eyeShape === 'circle') {
        parts.push(`  <circle cx="${x + 3.5}" cy="${y + 3.5}" r="3.5" fill="${fgColor}" mask="url(#mask-${id})" />\n`);
        parts.push(`  <circle cx="${x + 3.5}" cy="${y + 3.5}" r="1.5" fill="${fgColor}" />\n`);
      } else if (eyeShape === 'rounded') {
        parts.push(`  <rect x="${x}" y="${y}" width="7" height="7" rx="1.75" ry="1.75" fill="${fgColor}" mask="url(#mask-${id})" />\n`);
        parts.push(`  <rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="1.2" ry="1.2" fill="${fgColor}" />\n`);
      } else if (eyeShape === 'diamond') {
        parts.push(`  <path d="M ${x + 3.5} ${y} L ${x + 7} ${y + 3.5} L ${x + 3.5} ${y + 7} L ${x} ${y + 3.5} Z M ${x + 3.5} ${y + 1} L ${x + 6} ${y + 3.5} L ${x + 3.5} ${y + 6} L ${x + 1} ${y + 3.5} Z" fill="${fgColor}" fill-rule="evenodd" mask="url(#mask-${id})" />\n`);
        parts.push(`  <path d="M ${x + 3.5} ${y + 2} L ${x + 5} ${y + 3.5} L ${x + 3.5} ${y + 5} L ${x + 2} ${y + 3.5} Z" fill="${fgColor}" />\n`);
      } else {
        parts.push(`  <rect x="${x}" y="${y}" width="7" height="7" fill="${fgColor}" mask="url(#mask-${id})" />\n`);
        parts.push(`  <rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="${fgColor}" />\n`);
      }
    } else {
      // No mask, draw layered solid shapes
      if (eyeShape === 'circle') {
        parts.push(`  <circle cx="${x + 3.5}" cy="${y + 3.5}" r="3.5" fill="${fgColor}" />\n`);
        parts.push(`  <circle cx="${x + 3.5}" cy="${y + 3.5}" r="2.5" fill="${bgColor}" />\n`);
        parts.push(`  <circle cx="${x + 3.5}" cy="${y + 3.5}" r="1.5" fill="${fgColor}" />\n`);
      } else if (eyeShape === 'rounded') {
        parts.push(`  <rect x="${x}" y="${y}" width="7" height="7" rx="1.75" ry="1.75" fill="${fgColor}" />\n`);
        parts.push(`  <rect x="${x + 1}" y="${y + 1}" width="5" height="5" rx="1.25" ry="1.25" fill="${bgColor}" />\n`);
        parts.push(`  <rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="1.2" ry="1.2" fill="${fgColor}" />\n`);
      } else if (eyeShape === 'diamond') {
        parts.push(`  <path d="M ${x + 3.5} ${y} L ${x + 7} ${y + 3.5} L ${x + 3.5} ${y + 7} L ${x} ${y + 3.5} Z M ${x + 3.5} ${y + 1} L ${x + 6} ${y + 3.5} L ${x + 3.5} ${y + 6} L ${x + 1} ${y + 3.5} Z" fill="${fgColor}" fill-rule="evenodd" />\n`);
        parts.push(`  <path d="M ${x + 3.5} ${y + 1} L ${x + 6} ${y + 3.5} L ${x + 3.5} ${y + 6} L ${x + 1} ${y + 3.5} Z" fill="${bgColor}" />\n`);
        parts.push(`  <path d="M ${x + 3.5} ${y + 2} L ${x + 5} ${y + 3.5} L ${x + 3.5} ${y + 5} L ${x + 2} ${y + 3.5} Z" fill="${fgColor}" />\n`);
      } else {
        parts.push(`  <rect x="${x}" y="${y}" width="7" height="7" fill="${fgColor}" />\n`);
        parts.push(`  <rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="${bgColor}" />\n`);
        parts.push(`  <rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="${fgColor}" />\n`);
      }
    }
  };
  
  // Draw corner eyes
  writeEye('eye-tl', 0, 0);
  writeEye('eye-tr', 0, numModules - 7);
  writeEye('eye-bl', numModules - 7, 0);
  
  // Draw logo if present
  if (logoPreview) {
    const size = (totalModules * logoSize) / 100;
    const x = (totalModules - size) / 2;
    const y = (totalModules - size) / 2;
    const bgPadding = size * 0.15;
    
    if (logoBgMode === 'white') {
      parts.push(`  <rect x="${x - bgPadding}" y="${y - bgPadding}" width="${size + bgPadding * 2}" height="${size + bgPadding * 2}" fill="#ffffff" rx="${size * 0.2}" ry="${size * 0.2}" />\n`);
    }
    
    parts.push(`  <image x="${x}" y="${y}" width="${size}" height="${size}" href="${logoPreview}" />\n`);
  }
  
  parts.push('</svg>\n');
  return parts.join('');
};

const QRCodeGenerator = () => {
  const [text, setText] = useState('https://google.com');
  const [fgColor, setFgColor] = useState('#6366f1'); // Indigo 500
  const [bgColor, setBgColor] = useState('#ffffff'); // White
  const [errorLevel, setErrorLevel] = useState('H'); // High level for logos
  const [downloadSize, setDownloadSize] = useState(512); // Default resolution
  const [, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [logoSize, setLogoSize] = useState(20); // Percentage of QR Code size (15% - 30%)
  const [logoBgMode, setLogoBgMode] = useState('white'); // 'white', 'transparent', 'none'
  const [qrShape, setQrShape] = useState('square'); // 'square', 'circle', 'rounded', 'diamond'
  const [eyeShape, setEyeShape] = useState('square'); // 'square', 'circle', 'rounded'
  const [qrVersion, setQrVersion] = useState(0); // 0 = auto, 1-40 = manual
  const [generating, setGenerating] = useState(false);
  const [transparentBg, setTransparentBg] = useState(false);
  const [transparencyMode, setTransparencyMode] = useState('full'); // 'full', 'margin'
  const bgType = useMemo(() => {
    return !transparentBg ? 'solid' : (transparencyMode === 'margin' ? 'transparent-margin' : 'transparent-full');
  }, [transparentBg, transparencyMode]);
  const canvasRef = useRef(null);

  // Memoize QR data matrix -- recomputed only when text or errorLevel changes.
  // Shared between canvas rendering and SVG download to avoid duplicate QRCode.create() calls.
  const qrData = useMemo(() => {
    try {
      const opts = { errorCorrectionLevel: errorLevel };
      if (qrVersion > 0) opts.version = qrVersion;
      return QRCode.create(text || ' ', opts);
    } catch {
      return null;
    }
  }, [text, errorLevel, qrVersion]);

  // Stable canvas render function wrapped in useCallback
  const generateQR = useCallback(async () => {
    if (!canvasRef.current || !qrData) return;
    setGenerating(true);

    try {
      const canvas = canvasRef.current;
      const numModules = qrData.modules.size;
      const margin = 2;
      const totalModules = numModules + margin * 2;

      // Set canvas size matching the resolution
      canvas.width = downloadSize;
      canvas.height = downloadSize;
      canvas.style.width = downloadSize + 'px';
      canvas.style.height = downloadSize + 'px';

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, downloadSize, downloadSize);

      const moduleSize = downloadSize / totalModules;

      if (bgType === 'solid') {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, downloadSize, downloadSize);
      } else if (bgType === 'transparent-margin') {
        ctx.fillStyle = bgColor;
        const qrSize = numModules * moduleSize;
        const qrOffset = margin * moduleSize;
        ctx.fillRect(qrOffset, qrOffset, qrSize, qrSize);
      }

      // Draw body modules
      ctx.fillStyle = fgColor;
      for (let r = 0; r < numModules; r++) {
        for (let c = 0; c < numModules; c++) {
          const isDark = qrData.modules.data[r * numModules + c] === 1;
          if (!isDark) continue;

          // Skip finder patterns
          const isFinder = (r < 7 && c < 7) || (r < 7 && c >= numModules - 7) || (r >= numModules - 7 && c < 7);
          if (isFinder) continue;

          const x = (c + margin) * moduleSize;
          const y = (r + margin) * moduleSize;

          if (qrShape === 'circle') {
            ctx.beginPath();
            ctx.arc(x + moduleSize / 2, y + moduleSize / 2, moduleSize * 0.44, 0, Math.PI * 2);
            ctx.fill();
          } else if (qrShape === 'rounded') {
            ctx.beginPath();
            ctx.roundRect(x + moduleSize * 0.05, y + moduleSize * 0.05, moduleSize * 0.9, moduleSize * 0.9, moduleSize * 0.2);
            ctx.fill();
          } else if (qrShape === 'diamond') {
            ctx.beginPath();
            ctx.moveTo(x + moduleSize / 2, y + moduleSize * 0.05);
            ctx.lineTo(x + moduleSize * 0.95, y + moduleSize / 2);
            ctx.lineTo(x + moduleSize / 2, y + moduleSize * 0.95);
            ctx.lineTo(x + moduleSize * 0.05, y + moduleSize / 2);
            ctx.closePath();
            ctx.fill();
          } else {
            // square
            ctx.fillRect(x, y, moduleSize, moduleSize);
          }
        }
      }

      // Draw eyes
      const isTransparentFull = bgType === 'transparent-full';
      drawFinderPattern(ctx, 0, 0, moduleSize, margin, fgColor, bgColor, isTransparentFull, eyeShape);
      drawFinderPattern(ctx, 0, numModules - 7, moduleSize, margin, fgColor, bgColor, isTransparentFull, eyeShape);
      drawFinderPattern(ctx, numModules - 7, 0, moduleSize, margin, fgColor, bgColor, isTransparentFull, eyeShape);

      // Draw custom logo if present
      if (logoPreview) {
        const img = new Image();
        img.src = logoPreview;
        
        await new Promise((resolve, reject) => {
          const drawLogo = () => {
            const size = (downloadSize * logoSize) / 100;
            const x = (downloadSize - size) / 2;
            const y = (downloadSize - size) / 2;

            const bgPadding = size * 0.15;
            
            // Draw background card according to selected mode
            if (logoBgMode === 'white') {
              ctx.fillStyle = '#ffffff';
              ctx.beginPath();
              ctx.roundRect(x - bgPadding, y - bgPadding, size + bgPadding * 2, size + bgPadding * 2, size * 0.2);
              ctx.fill();
            } else if (logoBgMode === 'transparent') {
              // Clear the area behind the logo to create a transparent cutout
              ctx.save();
              ctx.globalCompositeOperation = 'destination-out';
              ctx.fillStyle = '#ffffff';
              ctx.beginPath();
              ctx.roundRect(x - bgPadding, y - bgPadding, size + bgPadding * 2, size + bgPadding * 2, size * 0.2);
              ctx.fill();
              ctx.restore();
            }
            // For 'none', do nothing (overlap directly)

            // Draw logo image
            ctx.drawImage(img, x, y, size, size);
            resolve();
          };

          // Fix: handle browser-cached images where onload already fired
          if (img.complete && img.naturalWidth > 0) {
            drawLogo();
          } else {
            img.onload = drawLogo;
            img.onerror = reject;
          }
        });
      }
    } catch (err) {
      console.error('QR Generation Error:', err);
    } finally {
      setGenerating(false);
    }
  }, [qrData, fgColor, bgColor, bgType, downloadSize, logoPreview, logoSize, logoBgMode, qrShape, eyeShape]);

  // Redraw QR Code when options change
  useEffect(() => {
    generateQR();
  }, [generateQR]);

  const handleLogoUpload = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check size limit (limit to 2MB for browser processing)
    if (file.size > 2 * 1024 * 1024) {
      window.showError('Ukuran file logo maksimal 2 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setLogoPreview(event.target.result);
      setLogoFile(file);
      window.showSuccess('Logo berhasil diunggah.');
    };
    reader.readAsDataURL(file);
  }, []);

  const handleRemoveLogo = useCallback(() => {
    setLogoFile(null);
    setLogoPreview(null);
    window.showInfo('Logo dihapus.');
  }, []);

  const downloadPNG = useCallback(() => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `qrcode_${Date.now()}.png`;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.showSuccess('QR Code PNG berhasil diunduh.');
  }, []);

  const downloadSVG = useCallback(() => {
    if (!qrData) return;
    try {
      // Reuse memoized qrData instead of calling QRCode.create() again
      const svgString = buildSVGString(qrData, fgColor, bgColor, bgType, qrShape, eyeShape, logoPreview, logoSize, logoBgMode);

      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `qrcode_${Date.now()}.svg`;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      window.showSuccess('QR Code SVG berhasil diunduh.');
    } catch (err) {
      window.showError('Gagal mendownload file SVG.');
      console.error(err);
    }
  }, [qrData, fgColor, bgColor, bgType, qrShape, eyeShape, logoPreview, logoSize, logoBgMode]);

  const handleQrShapeChange = useCallback((e) => {
    const val = e.target.value;
    setQrShape(val);
    // Auto-sync eye shape to match
    setEyeShape(val);
  }, []);

  const handleEyeShapeChange = useCallback((e) => {
    const val = e.target.value;
    setEyeShape(val);
    // Reverse sync: body modules follow eye shape
    setQrShape(val);
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>QR Code Generator</h2>
            <span style={{ padding: '2px 8px', borderRadius: '20px', backgroundColor: 'rgba(99,102,241,0.1)', color: 'var(--primary-color)', fontSize: '0.75rem', fontWeight: 600 }}>Pro Tool</span>
          </div>
          <p style={{ color: 'var(--text-muted)' }}>Buat QR Code berkualitas tinggi dengan desain warna dan logo kustom.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '24px', alignItems: 'start' }}>
        {/* PANEL KONTROL KIRI */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h3 style={STYLES.sectionHeading}>
              Pengaturan QR Code
            </h3>
            
            {/* Input URL atau Teks */}
            <div className="form-group">
              <label className="form-label" htmlFor="qr-content-input">Konten QR Code (Link / URL / Teks)</label>
              <textarea
                id="qr-content-input"
                className="form-control"
                style={{ minHeight: '80px', fontSize: '0.9rem' }}
                placeholder="Masukkan link web, nomor WhatsApp, atau teks di sini..."
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>

            {/* Warna Pembuat (Color Pickers) */}
            <div style={STYLES.twoColGrid}>
              <div className="form-group" style={STYLES.noMarginBottom}>
                <label className="form-label" htmlFor="fg-color-picker">Warna Foreground (QR)</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    id="fg-color-picker"
                    type="color"
                    className="form-control"
                    style={STYLES.colorPickerInput}
                    value={fgColor}
                    onChange={(e) => setFgColor(e.target.value)}
                  />
                  <input
                    aria-label="Warna Foreground Hex"
                    type="text"
                    className="form-control"
                    style={STYLES.colorHexInput}
                    value={fgColor}
                    onChange={(e) => setFgColor(e.target.value)}
                  />
                </div>
              </div>
              
              <div className="form-group" style={STYLES.noMarginBottom}>
                <label className="form-label" htmlFor="bg-color-picker">Warna Background</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    id="bg-color-picker"
                    type="color"
                    className="form-control"
                    style={{ ...STYLES.colorPickerInput, cursor: bgType === 'transparent-full' ? 'not-allowed' : 'pointer', opacity: bgType === 'transparent-full' ? 0.5 : 1 }}
                    value={bgColor}
                    onChange={(e) => setBgColor(e.target.value)}
                    disabled={bgType === 'transparent-full'}
                  />
                  <input
                    aria-label="Warna Background Hex"
                    type="text"
                    className="form-control"
                    style={{ ...STYLES.colorHexInput, opacity: bgType === 'transparent-full' ? 0.5 : 1 }}
                    value={bgType === 'transparent-full' ? 'TRANSPARENT' : bgColor}
                    onChange={(e) => setBgColor(e.target.value)}
                    disabled={bgType === 'transparent-full'}
                  />
                </div>
              </div>
            </div>

            {/* Checkbox Background Transparan */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', marginBottom: '12px' }}>
              <input
                id="transparent-bg-checkbox"
                type="checkbox"
                checked={transparentBg}
                onChange={(e) => setTransparentBg(e.target.checked)}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <label htmlFor="transparent-bg-checkbox" style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-main)', cursor: 'pointer', userSelect: 'none' }}>
                Latar Belakang Transparan (Transparent Background)
              </label>
            </div>

            {/* Sub-opsi Gaya Transparansi */}
            {transparentBg && (
              <div className="form-group" style={{ marginLeft: '24px', marginBottom: '16px' }}>
                <label className="form-label" htmlFor="transparency-mode-select" style={{ fontSize: '0.8rem' }}>Gaya Transparansi</label>
                <select
                  id="transparency-mode-select"
                  className="form-control"
                  value={transparencyMode}
                  onChange={(e) => setTransparencyMode(e.target.value)}
                  style={{ fontSize: '0.85rem', padding: '6px 10px', height: '36px' }}
                >
                  <option value="full">Transparan Penuh (Benar-benar transparan, hanya blok QR)</option>
                  <option value="margin">Transparan Hanya Margin (Bagian QR tetap ada latar belakang agar mudah discan)</option>
                </select>
              </div>
            )}

            {/* Bentuk QR Code (Shapes) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '12px', marginBottom: '16px' }}>
              <div className="form-group" style={STYLES.noMarginBottom}>
                <label className="form-label" htmlFor="qr-shape-select">Bentuk Modul QR</label>
                <select
                  id="qr-shape-select"
                  className="form-control"
                  value={qrShape}
                  onChange={handleQrShapeChange}
                >
                  <option value="square">Kotak Klasik</option>
                  <option value="circle">Bulat / Lingkaran</option>
                  <option value="rounded">Kotak Tumpul (Rounded)</option>
                  <option value="diamond">Wajik / Diamond</option>
                </select>
              </div>

              <div className="form-group" style={STYLES.noMarginBottom}>
                <label className="form-label" htmlFor="eye-shape-select">Bentuk Mata Pojok (Eye)</label>
                <select
                  id="eye-shape-select"
                  className="form-control"
                  value={eyeShape}
                  onChange={handleEyeShapeChange}
                >
                  <option value="square">Kotak Klasik</option>
                  <option value="circle">Bulat / Lingkaran</option>
                  <option value="rounded">Kotak Tumpul (Rounded)</option>
                  <option value="diamond">Wajik / Diamond</option>
                </select>
              </div>
            </div>

            {/* Parameter QR: Error Correction & Resolusi */}
            <div style={STYLES.twoColGrid}>
              <div className="form-group" style={STYLES.noMarginBottom}>
                <label className="form-label" htmlFor="error-level-select">Error Correction Level</label>
                <select
                  id="error-level-select"
                  className="form-control"
                  value={errorLevel}
                  onChange={(e) => setErrorLevel(e.target.value)}
                >
                  <option value="L">Low (7% recovery)</option>
                  <option value="M">Medium (15% recovery)</option>
                  <option value="Q">Quartile (25% recovery)</option>
                  <option value="H">High (30% recovery - disarankan jika menggunakan logo)</option>
                </select>
              </div>

              <div className="form-group" style={STYLES.noMarginBottom}>
                <label className="form-label" htmlFor="resolution-select">Resolusi Ekspor (Download)</label>
                <select
                  id="resolution-select"
                  className="form-control"
                  value={downloadSize}
                  onChange={(e) => setDownloadSize(Number(e.target.value))}
                >
                  <option value={256}>256 x 256 px</option>
                  <option value={512}>512 x 512 px</option>
                  <option value={1024}>1024 x 1024 px</option>
                  <option value={2048}>2048 x 2048 px (Super Sharp)</option>
                </select>
              </div>
            </div>

            {/* QR Version (Kepadatan) */}
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label className="form-label" htmlFor="qr-version-select">Kepadatan QR (Version)</label>
              <select
                id="qr-version-select"
                className="form-control"
                value={qrVersion}
                onChange={(e) => setQrVersion(Number(e.target.value))}
              >
                <option value={0}>Auto (otomatis minimum)</option>
                <option value={3}>Version 3 (29 modul)</option>
                <option value={4}>Version 4 (33 modul)</option>
                <option value={5}>Version 5 (37 modul)</option>
                <option value={6}>Version 6 (41 modul)</option>
                <option value={7}>Version 7 (45 modul)</option>
                <option value={8}>Version 8 (49 modul)</option>
                <option value={9}>Version 9 (53 modul)</option>
                <option value={10}>Version 10 (57 modul)</option>
              </select>
              {qrVersion > 0 && !qrData && (
                <div style={{ marginTop: '8px', padding: '8px 10px', borderRadius: '6px', backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', fontSize: '0.75rem', color: 'var(--danger)' }}>
                  Version {qrVersion} terlalu kecil untuk data saat ini. Naikkan version atau kurangi teks.
                </div>
              )}
            </div>
          </div>

          {/* Pengaturan Logo */}
          <div>
            <h3 style={STYLES.sectionHeading}>
              Sematkan Logo Tengah (Opsional)
            </h3>
            
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Box Upload */}
              <div style={{ flex: 1, minWidth: '200px' }}>
                <label 
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '12px',
                    border: '2px dashed var(--border-color)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: 'var(--text-muted)',
                    backgroundColor: 'rgba(248, 250, 252, 0.5)',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--primary-color)'}
                  onMouseOut={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                >
                  <Upload size={16} />
                  <span>Pilih File Logo</span>
                  <input
                    aria-label="Upload File Logo"
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>

              {/* Logo Preview & Delete */}
              {logoPreview && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    padding: '4px',
                    backgroundColor: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <img 
                      src={logoPreview} 
                      alt="Logo Preview" 
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px' }} 
                    />
                  </div>
                  <button 
                    className="btn btn-outline" 
                    onClick={handleRemoveLogo}
                    style={{ padding: '8px 12px', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                  >
                    <Trash2 size={15} />
                    <span>Hapus</span>
                  </button>
                </div>
              )}
            </div>

            {/* Slider Ukuran Logo */}
            {logoPreview && (
              <div className="form-group" style={{ marginTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label className="form-label" htmlFor="logo-size-slider">Ukuran Logo Tengah ({logoSize}%)</label>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Rekomendasi: 18% - 24%</span>
                </div>
                <input
                  id="logo-size-slider"
                  type="range"
                  min="15"
                  max="30"
                  value={logoSize}
                  onChange={(e) => setLogoSize(Number(e.target.value))}
                  style={{
                    width: '100%',
                    accentColor: 'var(--primary-color)',
                    cursor: 'pointer'
                  }}
                />
              </div>
            )}

            {/* Latar Belakang Wadah Logo */}
            {logoPreview && (
              <div className="form-group" style={{ marginTop: '16px' }}>
                <label className="form-label" htmlFor="logo-bg-mode-select">Latar Belakang Wadah Logo</label>
                <select
                  id="logo-bg-mode-select"
                  className="form-control"
                  value={logoBgMode}
                  onChange={(e) => setLogoBgMode(e.target.value)}
                  style={{ fontSize: '0.9rem' }}
                >
                  <option value="white">Putih Solid (Disarankan untuk keterbacaan)</option>
                  <option value="transparent">Potongan Transparan (Menghapus QR di bawah logo)</option>
                  <option value="none">Tanpa Wadah (Logo langsung di atas QR)</option>
                </select>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginTop: '6px', lineHeight: '1.4' }}>
                  Gunakan "Potongan Transparan" jika Anda menggunakan file logo berformat PNG transparan dan ingin latar di belakangnya transparan tanpa tertutup modul QR.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* PANEL PREVIEW KANAN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card text-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '4px' }}>Preview</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '20px' }}>Tampilan QR Code hasil modifikasi</p>
            
            {/* Box Render Canvas */}
            <div style={{
              padding: '16px',
              borderRadius: '16px',
              backgroundColor: bgType !== 'solid' ? '#f8fafc' : 'white',
              backgroundImage: bgType !== 'solid'
                ? 'conic-gradient(#f1f5f9 25%, #ffffff 0 50%, #f1f5f9 0 75%, #ffffff 0)' 
                : 'none',
              backgroundSize: '20px 20px',
              border: '1px solid var(--border-color)',
              boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.02)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              aspectRatio: '1',
              maxWidth: '280px',
              position: 'relative',
              overflow: 'hidden'
            }}>
              <canvas 
                ref={canvasRef} 
                style={{ 
                  width: '100%', 
                  aspectRatio: '1 / 1', 
                  maxWidth: '240px',
                  display: text ? 'block' : 'none',
                  objectFit: 'contain'
                }} 
              />
              {!text && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', color: 'var(--text-light)' }}>
                  <QrCode size={48} style={{ opacity: 0.3 }} />
                  <span style={{ fontSize: '0.85rem' }}>Masukkan link/URL</span>
                </div>
              )}
            </div>

            {/* Tombol Aksi Unduh */}
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '24px' }}>
              <button 
                className="btn btn-primary w-full"
                onClick={downloadPNG}
                disabled={!text || generating}
                style={{ height: '42px', fontWeight: 600 }}
              >
                <Download size={16} />
                <span>Unduh PNG</span>
              </button>
              
              <button 
                className="btn btn-outline w-full"
                onClick={downloadSVG}
                disabled={!text || generating}
                style={{ height: '42px', fontWeight: 600 }}
              >
                <Download size={16} />
                <span>Unduh SVG</span>
              </button>

              {bgType !== 'solid' && (
                <div style={{
                  marginTop: '12px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  backgroundColor: bgType === 'transparent-full' ? 'rgba(239, 68, 68, 0.05)' : 'rgba(99, 102, 241, 0.05)',
                  border: bgType === 'transparent-full' ? '1px dashed rgba(239, 68, 68, 0.2)' : '1px dashed rgba(99, 102, 241, 0.2)',
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  textAlign: 'left',
                  lineHeight: '1.4'
                }}>
                  {bgType === 'transparent-full' ? (
                    <>
                      <strong>Peringatan Pemindaian:</strong> QR Code dengan latar belakang transparan penuh mungkin tidak dapat dipindai oleh beberapa aplikasi scanner jika diletakkan di atas permukaan/latar yang gelap karena kurangnya kontras. Disarankan menggunakan <strong>Transparan Hanya Margin</strong> untuk menjaga fungsionalitas scan.
                    </>
                  ) : (
                    <>
                      <strong>Info Transparansi:</strong> Mode ini membuat area pinggir (margin) luar transparan sehingga menyatu rapi dengan desain Anda, namun area QR tetap memiliki latar belakang agar selalu mudah dipindai (scannable).
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QRCodeGenerator;
