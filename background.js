chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Arxa planda saxlanılan məlumatlar üçün state
// Format: { tabId: { image: base64, status: 'loading' | 'results' | 'error', data: resultsOrErrorMessage } }
let captureState = {};

chrome.commands.onCommand.addListener((command) => {
  if (command === 'trigger_capture') {
    // Asinxron sorğudan əvvəl (istifadəçi jesti itmədən) paneli dərhal açırıq
    chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT }).catch(() => {});
    
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab) startCaptureFlow(tab);
    });
  }
});

// Chrome extension ikonuna klikləyəndə side panel avtomatik açılır (openPanelOnActionClick: true)

async function startCaptureFlow(tab) {
  try {
    // 1. Content script-ləri inyeksiya et
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['content.css']
    });
    
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    // Ekran şəklini çək
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    
    // Şəkli content script-ə göndər
    await chrome.tabs.sendMessage(tab.id, { 
      action: 'START_SELECTION', 
      image: dataUrl 
    });

  } catch (error) {
    console.error("Capture flow error:", error);
  }
}

// Content script və side panel-dən gələn mesajları dinləmək
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'TRIGGER_CAPTURE_FROM_PANEL') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab) startCaptureFlow(tab);
    });
  } else if (request.action === 'SELECTION_MADE') {
    const croppedImage = request.image;
    const tabId = sender.tab.id;
    
    // State-i yeniləyirik: "loading" vəziyyəti
    captureState[tabId] = {
      image: croppedImage,
      status: 'loading'
    };
    
    // Əgər panel artıq açıqdırsa, ona məlumat ver
    chrome.runtime.sendMessage({
      action: 'PROCESS_IMAGE',
      image: croppedImage,
      tabId: tabId
    }).catch(() => {});
    
    processWithSerpApi(croppedImage, tabId);
    
    sendResponse({ success: true });
  } else if (request.action === 'GET_CURRENT_STATE') {
    // Side panel açılanda hazırkı vəziyyəti istəyir
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && captureState[tab.id]) {
        sendResponse({ 
          hasImage: true, 
          state: captureState[tab.id] 
        });
      } else {
        sendResponse({ hasImage: false });
      }
    })();
    return true; // async response
  }
});

const fetchWithTimeout = async (resource, options = {}) => {
  const { timeout = 15000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(resource, { ...options, signal: controller.signal });
  clearTimeout(id);
  return response;
};

// SerpApi və ImgBB inteqrasiyası
async function processWithSerpApi(base64Image, tabId) {
  try {
    const imgbbKey = '28d981f64fe117f96c426d13980127e3';
    const base64Data = base64Image.split(',')[1];
    
    // URLSearchParams istifadə etmək daha etibarlıdır
    const formData = new FormData();
    formData.append('image', base64Data);
    // Şəkillərin ImgBB hesabınızda yığılıb qalmaması üçün 60 saniyədən sonra avtomatik silinməsi (expiration) əlavə edirik:
    formData.append('expiration', '60'); 
    
    const uploadRes = await fetchWithTimeout(`https://api.imgbb.com/1/upload?key=${imgbbKey}`, {
      method: 'POST',
      body: formData
    });
    
    const uploadJson = await uploadRes.json();
    if (!uploadJson.success) {
      throw new Error(`ImgBB Xətası: ${uploadJson.error ? uploadJson.error.message : 'Bilinməyən xəta'}`);
    }
    
    const imageUrl = uploadJson.data.url;
    
    // SerpApi sorğusu
    const serpApiKey = '1d13e59ea64308c6bd47f71fa9736169cb684ca97305a694733e714d3fe911fe';
    const serpApiUrl = `https://serpapi.com/search.json?engine=google_lens&url=${encodeURIComponent(imageUrl)}&api_key=${serpApiKey}`;
    
    const serpRes = await fetchWithTimeout(serpApiUrl, { timeout: 15000 });
    const serpData = await serpRes.json();
    
    if (serpData.error) {
       throw new Error(`SerpApi Xətası: ${serpData.error}`);
    }
    
    const matches = serpData.visual_matches || [];
    const allowedStores = ['trendyol', 'amazon', 'temu', 'aliexpress'];
    
    let groupedResults = { trendyol: [], amazon: [], temu: [], aliexpress: [] };
    
    for (let match of matches) {
      const sourceUrl = match.link || '';
      const sourceName = (match.source || '').toLowerCase();
      
      let matchedStore = allowedStores.find(store => 
        sourceName.includes(store) || sourceUrl.includes(store)
      );
      
      if (matchedStore) {
        const displayStore = matchedStore.charAt(0).toUpperCase() + matchedStore.slice(1);
        
        let affiliateLink = sourceUrl;
        if (matchedStore === 'amazon') affiliateLink += (sourceUrl.includes('?') ? '&' : '?') + 'tag=wardroberadar-20';
        else if (matchedStore === 'trendyol') affiliateLink += (sourceUrl.includes('?') ? '&' : '?') + 'utm_source=aff_wardrobe_radar';
        else if (matchedStore === 'temu') affiliateLink += (sourceUrl.includes('?') ? '&' : '?') + 'aff_id=wardrobe_radar';
        else if (matchedStore === 'aliexpress') affiliateLink += (sourceUrl.includes('?') ? '&' : '?') + 'aff_short_key=wardrobe_radar';

        let price = match.price ? `${match.price.extracted_value} ${match.price.currency}` : "Qiymət yoxdur";
        if (match.price && match.price.currency === '$') price = `$${match.price.extracted_value}`;

        // Eyni linkin təkrar olunmasının qarşısını alaq
        if (!groupedResults[matchedStore].find(item => item.link === affiliateLink)) {
          groupedResults[matchedStore].push({
            id: match.position || Math.random().toString(),
            title: match.title || "Geyim tapıldı",
            price: price,
            store: displayStore,
            image: match.thumbnail || "https://via.placeholder.com/150?text=Şəkil+Yoxdur",
            link: affiliateLink
          });
        }
      }
    }

    // Nəticələri mağazalar arasında balanslaşdırmaq (Round-Robin)
    let filteredResults = [];
    let i = 0;
    const MAX_RESULTS = 16; // Ekranda qəşəng görünsün deyə 16 ədəd (4 sütundan)
    
    while (filteredResults.length < MAX_RESULTS) {
      let addedInThisRound = false;
      for (let store of allowedStores) {
        if (groupedResults[store].length > i) {
          filteredResults.push(groupedResults[store][i]);
          addedInThisRound = true;
          if (filteredResults.length >= MAX_RESULTS) break;
        }
      }
      if (!addedInThisRound) break; // Heç bir mağazada əlavə məhsul qalmadı
      i++;
    }

    // State-i yeniləyirik
    if (captureState[tabId]) {
      captureState[tabId].status = 'results';
      captureState[tabId].data = filteredResults;
    }

    chrome.runtime.sendMessage({
      action: 'RESULTS_READY',
      results: filteredResults,
      tabId: tabId
    }).catch(e => console.log("Panel error", e));

  } catch (error) {
    console.error("SerpApi error:", error);
    
    let errorMessage = "Xəta baş verdi: " + error.message;
    if (error.name === 'AbortError' || error.message.includes('Failed to fetch')) {
        errorMessage = "Bağlantı xətası: Şəkil yükləmə serveri bloklanıb və ya internet problemi var. Zəhmət olmasa VPN ilə yoxlayın.";
    }

    if (captureState[tabId]) {
      captureState[tabId].status = 'error';
      captureState[tabId].data = errorMessage;
    }

    chrome.runtime.sendMessage({
      action: 'RESULTS_ERROR',
      message: errorMessage,
      tabId: tabId
    }).catch(e => console.log("Panel closed", e));
  }
}
