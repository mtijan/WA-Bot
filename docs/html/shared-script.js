document.addEventListener('DOMContentLoaded', () => {
  // 1. Inject Lightbox HTML if not present
  if (!document.getElementById('lightbox')) {
    const lightboxHtml = `
      <div class="lightbox-overlay" id="lightbox">
        <button class="lightbox-close" id="lightbox-close" aria-label="Tutup gambar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
        <div class="lightbox-img-wrapper" id="lightbox-wrapper">
          <img class="lightbox-img" id="lightbox-img" src="" alt="Perbesar gambar">
        </div>
        <div class="lightbox-controls">
          <button class="lightbox-control-btn" id="zoom-out" aria-label="Perkecil">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>
          <span class="lightbox-zoom-level" id="zoom-level">100%</span>
          <button class="lightbox-control-btn" id="zoom-in" aria-label="Perbesar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>
          <button class="lightbox-control-btn" id="zoom-reset" aria-label="Sesuaikan ukuran" style="font-size: 0.78rem; font-weight: 600; padding: 0 0.4rem; width: auto; border-radius: 4px;">
            Fit
          </button>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', lightboxHtml);
  }

  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxClose = document.getElementById('lightbox-close');
  const lightboxWrapper = document.getElementById('lightbox-wrapper');
  
  const btnZoomIn = document.getElementById('zoom-in');
  const btnZoomOut = document.getElementById('zoom-out');
  const btnZoomReset = document.getElementById('zoom-reset');
  const txtZoomLevel = document.getElementById('zoom-level');

  // Pan & Zoom State variables
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let isDragging = false;
  let startX = 0;
  let startY = 0;

  // Render current transforms and update UI elements
  const updateTransform = () => {
    lightboxImg.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    if (txtZoomLevel) {
      txtZoomLevel.textContent = `${Math.round(scale * 100)}%`;
    }
    
    // Manage cursor indications
    if (scale > 1) {
      lightboxImg.style.cursor = isDragging ? 'grabbing' : 'grab';
    } else {
      lightboxImg.style.cursor = 'zoom-in';
    }
  };

  // Zoom controls actions
  const adjustZoom = (amount) => {
    scale = Math.min(4, Math.max(0.25, scale + amount));
    if (scale === 1) {
      translateX = 0;
      translateY = 0;
    }
    updateTransform();
  };

  const resetZoom = () => {
    scale = 1;
    translateX = 0;
    translateY = 0;
    updateTransform();
  };

  if (btnZoomIn) {
    btnZoomIn.addEventListener('click', (e) => {
      e.stopPropagation();
      adjustZoom(0.25);
    });
  }

  if (btnZoomOut) {
    btnZoomOut.addEventListener('click', (e) => {
      e.stopPropagation();
      adjustZoom(-0.25);
    });
  }

  if (btnZoomReset) {
    btnZoomReset.addEventListener('click', (e) => {
      e.stopPropagation();
      resetZoom();
    });
  }

  // 2. Event delegation for zoomable images and dynamically rendered Mermaid SVGs
  document.body.addEventListener('click', (e) => {
    const target = e.target.closest('img, .mermaid svg');
    if (!target) return;

    // Verify it belongs to a zoomable container
    const isZoomableImg = target.tagName.toLowerCase() === 'img' && target.closest('.mermaid-container, .gallery-item, .content-card, .gallery-grid');
    const isMermaidSvg = target.tagName.toLowerCase() === 'svg' && target.closest('.mermaid');

    if (!isZoomableImg && !isMermaidSvg) return;

    if (target.parentElement && target.parentElement.tagName === 'A') {
      e.preventDefault();
    }

    let src;
    let alt = target.getAttribute('alt') || 'Tampilan gambar';

    if (isMermaidSvg) {
      const svgData = new XMLSerializer().serializeToString(target);
      src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgData);
      alt = "Diagram Diagram";
    } else {
      src = target.getAttribute('src');
    }

    if (!src) return;

    lightboxImg.setAttribute('src', src);
    lightboxImg.setAttribute('alt', alt);
    
    // Reset zoom/pan status to initial state when opening new image
    resetZoom();
    
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden'; // Disable scroll under overlay
  });

  // Toggle zoom on image click
  lightboxImg.addEventListener('click', (e) => {
    e.stopPropagation();
    if (scale === 1) {
      scale = 2; // Zoom to 200% on click
    } else {
      scale = 1; // Fit again
      translateX = 0;
      translateY = 0;
    }
    updateTransform();
  });

  // Drag & Pan implementation
  lightboxImg.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (scale > 1) {
      isDragging = true;
      startX = e.clientX - translateX;
      startY = e.clientY - translateY;
      updateTransform();
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    translateX = e.clientX - startX;
    translateY = e.clientY - startY;
    updateTransform();
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      updateTransform();
    }
  });

  // 3. Close overlay functions
  const closeLightbox = () => {
    lightbox.classList.remove('active');
    document.body.style.overflow = ''; // Restore scrolling
    setTimeout(() => {
      lightboxImg.setAttribute('src', '');
      resetZoom();
    }, 300);
  };

  if (lightboxClose) {
    lightboxClose.addEventListener('click', closeLightbox);
  }
  
  if (lightbox) {
    lightbox.addEventListener('click', (e) => {
      // Close overlay only when clicking outside controls panel and image wrapper
      const controls = document.querySelector('.lightbox-controls');
      if (e.target === lightbox || e.target === lightboxWrapper || e.target.id === 'lightbox') {
        if (controls && controls.contains(e.target)) return;
        closeLightbox();
      }
    });
  }

  // Esc key close overlay
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightbox && lightbox.classList.contains('active')) {
      closeLightbox();
    }
  });

  // Inject Mermaid JS for diagram rendering
  const mermaidScript = document.createElement('script');
  mermaidScript.type = 'module';
  mermaidScript.textContent = `
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
    
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark' || 
                   (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
                   
    mermaid.initialize({ 
      startOnLoad: true, 
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'loose'
    });
    
    // Optional: Reload to re-render mermaid with new theme if toggle is clicked
    const toggleBtn = document.querySelector('.theme-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        setTimeout(() => location.reload(), 50);
      });
    }
  `;
  document.body.appendChild(mermaidScript);
});
