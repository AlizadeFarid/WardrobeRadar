document.addEventListener('DOMContentLoaded', () => {
  const stateEmpty = document.getElementById('state-empty');
  const stateLoading = document.getElementById('state-loading');
  const stateResults = document.getElementById('state-results');
  const stateError = document.getElementById('state-error');
  
  const previewImage = document.getElementById('preview-image');
  const resultsContainer = document.getElementById('results-container');
  const resultsCount = document.getElementById('results-count');
  const errorMessageEl = document.getElementById('error-message');

  function showState(state) {
    stateEmpty.classList.remove('active');
    stateLoading.classList.remove('active');
    stateResults.classList.remove('active');
    stateError.classList.remove('active');

    if (state === 'empty') stateEmpty.classList.add('active');
    else if (state === 'loading') stateLoading.classList.add('active');
    else if (state === 'results') stateResults.classList.add('active');
    else if (state === 'error') stateError.classList.add('active');
  }

  function renderResults(results) {
    resultsContainer.innerHTML = '';
    resultsCount.textContent = results.length;

    if (results.length === 0) {
      resultsContainer.innerHTML = '<p style="text-align:center; color:var(--text-muted); margin-top:20px;">Heç nə tapılmadı.</p>';
      return;
    }

    results.forEach(item => {
      const storeClass = item.store.toLowerCase();
      
      const card = document.createElement('a');
      card.className = 'product-card';
      card.href = item.link;
      card.target = '_blank';
      
      card.innerHTML = `
        <img src="${item.image}" alt="Product" class="product-img">
        <div class="product-info">
          <div class="product-title">${item.title}</div>
          <div class="product-bottom">
            <div class="product-price ${item.price === 'Qiymət yoxdur' ? 'no-price' : ''}">${item.price}</div>
            <div class="store-tag store-${storeClass}">${item.store}</div>
          </div>
        </div>
      `;
      
      resultsContainer.appendChild(card);
    });
  }

  const startBtn = document.getElementById('start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'TRIGGER_CAPTURE_FROM_PANEL' });
    });
  }

  const retryBtn = document.getElementById('retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'TRIGGER_CAPTURE_FROM_PANEL' });
    });
  }

  // Check initial state
  chrome.runtime.sendMessage({ action: 'GET_CURRENT_STATE' }, (response) => {
    if (response && response.hasImage && response.state) {
      if (response.state.image) previewImage.src = response.state.image;
      
      if (response.state.status === 'loading') {
        showState('loading');
      } else if (response.state.status === 'results') {
        renderResults(response.state.data);
        showState('results');
      } else if (response.state.status === 'error') {
        errorMessageEl.textContent = response.state.data;
        showState('error');
      }
    } else {
      showState('empty');
    }
  });

  // Listen for background updates
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'PROCESS_IMAGE') {
      previewImage.src = request.image;
      showState('loading');
      sendResponse({ success: true });
    } 
    else if (request.action === 'RESULTS_READY') {
      renderResults(request.results);
      showState('results');
      sendResponse({ success: true });
    }
    else if (request.action === 'RESULTS_ERROR') {
      errorMessageEl.textContent = request.message;
      showState('error');
      sendResponse({ success: true });
    }
  });

});
