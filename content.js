(function() {
  if (window.wardrobeRadarInjected) return;
  window.wardrobeRadarInjected = true;

  let overlay = null;
  let selectionBox = null;
  let startX = 0;
  let startY = 0;
  let isSelecting = false;
  let currentScreenshotUrl = null;
  let pausedVideos = [];

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'START_SELECTION') {
      currentScreenshotUrl = request.image;
      startSelectionMode();
      sendResponse({ status: "started" });
    }
  });

  function pauseVideos() {
    pausedVideos = [];
    document.querySelectorAll('video').forEach(video => {
      if (!video.paused) {
        video.pause();
        pausedVideos.push(video);
      }
    });
  }

  function resumeVideos() {
    pausedVideos.forEach(video => {
      video.play().catch(e => console.log("Could not auto-play video", e));
    });
    pausedVideos = [];
  }

  function startSelectionMode() {
    if (overlay) return; // Already active

    pauseVideos();

    // Create overlay container
    overlay = document.createElement('div');
    overlay.id = 'wardrobe-radar-overlay';

    // Create instruction text
    const instruction = document.createElement('div');
    instruction.id = 'wardrobe-radar-instruction';
    instruction.innerText = 'Bəyəndiyiniz geyimi seçin (Kursoru sürükləyin)';
    overlay.appendChild(instruction);

    // Create selection box
    selectionBox = document.createElement('div');
    selectionBox.id = 'wardrobe-radar-selection-box';
    overlay.appendChild(selectionBox);

    document.body.appendChild(overlay);

    overlay.addEventListener('mousedown', onMouseDown);
    overlay.addEventListener('mousemove', onMouseMove);
    overlay.addEventListener('mouseup', onMouseUp);
    
    // Add escape to cancel
    document.addEventListener('keydown', onKeyDown);
  }

  function stopSelectionMode() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    selectionBox = null;
    resumeVideos();
    document.removeEventListener('keydown', onKeyDown);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      stopSelectionMode();
    }
  }

  function onMouseDown(e) {
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;
    
    selectionBox.style.display = 'block';
    selectionBox.style.left = startX + 'px';
    selectionBox.style.top = startY + 'px';
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    
    // Dim outside effect is handled by CSS box-shadow
  }

  function onMouseMove(e) {
    if (!isSelecting) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    const left = Math.min(currentX, startX);
    const top = Math.min(currentY, startY);

    selectionBox.style.width = width + 'px';
    selectionBox.style.height = height + 'px';
    selectionBox.style.left = left + 'px';
    selectionBox.style.top = top + 'px';
  }

  async function onMouseUp(e) {
    if (!isSelecting) return;
    isSelecting = false;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    const left = Math.min(currentX, startX);
    const top = Math.min(currentY, startY);

    // Only process if selection is large enough
    if (width > 20 && height > 20) {
      // Show flash animation
      selectionBox.classList.add('wr-flash-anim');
      
      try {
        const croppedImage = await cropImage(currentScreenshotUrl, left, top, width, height);
        
        // Send to background
        chrome.runtime.sendMessage({
          action: 'SELECTION_MADE',
          image: croppedImage
        });
      } catch (err) {
        console.error("Cropping failed:", err);
      }
      
      // Wait for animation
      setTimeout(() => {
        stopSelectionMode();
      }, 400);
    } else {
      // Selection too small, just hide box
      selectionBox.style.display = 'none';
    }
  }

  function cropImage(dataUrl, x, y, width, height) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        
        // Cihazın (Retina) və ya brauzer zoom-unun əsl miqyasını hesablamaq
        const scaleX = img.width / window.innerWidth;
        const scaleY = img.height / window.innerHeight;
        
        canvas.width = width * scaleX;
        canvas.height = height * scaleY;
        
        const ctx = canvas.getContext('2d');
        
        // Kəsilmiş hissəni çəkirik
        ctx.drawImage(
          img, 
          x * scaleX, y * scaleY, width * scaleX, height * scaleY, // Mənbə koordinatları
          0, 0, canvas.width, canvas.height // Hədəf koordinatları
        );
        
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

})();
