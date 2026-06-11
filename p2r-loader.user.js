// ==UserScript==
// @name         P2R CPT Dashboard Loader - NCL1
// @namespace    wprijaco.p2r.loader
// @version      1.0
// @description  Official loader for P2R CPT Dashboard
// @author       Prince Jacob (Wprijaco)
// @match        https://rodeo-dub.amazon.com/NCL1/Search*
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/YOURNAME/tampermonkey-scripts/main/p2r-loader.user.js
// @downloadURL  https://raw.githubusercontent.com/YOURNAME/tampermonkey-scripts/main/p2r-loader.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const MAIN_SCRIPT_URL =
    'https://raw.githubusercontent.com/YOURNAME/tampermonkey-scripts/main/p2r-main.js';

  GM_xmlhttpRequest({
    method: 'GET',
    url: MAIN_SCRIPT_URL,
    onload: function (res) {
      if (res.status !== 200) {
        alert('P2R Dashboard official script could not be loaded.');
        return;
      }

      const code = res.responseText;

      if (!code.includes('OFFICIAL_P2R_CPT_SCRIPT_PRINCE_JACOB')) {
        alert('P2R Dashboard verification failed. Official marker missing.');
        return;
      }

      const script = document.createElement('script');
      script.textContent = code;
      document.documentElement.appendChild(script);
      script.remove();
    },
    onerror: function () {
      alert('P2R Dashboard could not connect to official GitHub source.');
    }
  });
})();
