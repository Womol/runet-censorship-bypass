'use strict';

{ // Private namespace starts.

  const kitchenStorageKey = 'pac-kitchen-kept-mods';
  const kitchenStartsMark = '\n\n//%#@@@@@@ PAC_KITCHEN_STARTS @@@@@@#%';

  const configs = {

    ifProxyHttpsUrlsOnly: {
      dflt: false,
      label: 'проксировать только HTTP<span style="border-bottom: 1px solid black">S</span>-сайты',
      desc: 'Проксировать только сайты, доступные по шифрованному протоколу HTTPS. Прокси и провайдер смогут видеть только адреса посещаемых вами ресурсов, но не их содержимое.',
      index: 0,
    },
    ifUseSecureProxiesOnly: {
      dflt: false,
      label: 'только шифрованная связь с прокси',
      desc: 'Шифровать соединение до прокси от провайдера. Провайдер всё же сможет видеть адреса (но не содержимое) посещаемых вами ресурсов из протокола DNS.',
      index: 1,
    },
    ifUsePacScriptProxies: {
      dflt: true,
      label: 'использовать прокси PAC-скрипта',
      desc: 'Использовать прокси от авторов PAC-скрипта.',
      index: 2,
    },
    ifUseLocalTor: {
      dflt: false,
      label: 'использовать свой локальный TOR',
      desc: 'Установите TOR на свой компьютер и используйте его как прокси. <a href="https://rebrand.ly/ac-tor">ВАЖНО</a>',
      index: 3,
    },
    customProxyStringRaw: {
      dflt: '',
      label: 'использовать свои прокси',
      url: 'https://rebrand.ly/ac-own-proxy',
      index: 4,
    },

  };

  const getDefaults = function getDefaults() {

    return Object.keys(configs).reduce((acc, key) => {

      acc[key] = configs[key].dflt;
      return acc;

    }, {});

  };

  const getCurrentConfigs = function getCurrentConfigs() {

    const json = localStorage.getItem(kitchenStorageKey);
    if (!json) {
      return null;
    }
    return new PacModifiers(JSON.parse(json));

  };

  const getOrderedConfigsForUser = function getOrderedConfigs() {

    const pacMods = getCurrentConfigs() || {};
    return Object.keys(configs).reduce((arr, key) => {

      const conf = configs[key]
      arr[conf.index] = conf;
      conf.value = (key in pacMods) ? pacMods[key] : conf.dflt;
      conf.key = key;
      return arr;

    }, []);

  };

  class PacModifiers {

    constructor(mods = {}) {

      const defaults = getDefaults();
      const ifAllDefaults =
        Object.keys(defaults)
        .every(
          (prop) => !(prop in mods) || Boolean(defaults[prop]) === Boolean(mods[prop])
        );

      Object.assign(this, defaults, mods);
      this.ifNoMods = ifAllDefaults ? true : false;

      let customProxyArray = [];
      if (this.customProxyStringRaw) {
        customProxyArray = this.customProxyStringRaw
          .replace(/#.*$/mg, '') // Strip comments.
          .split( /(?:[^\S\r\n]*(?:;|\r?\n)+[^\S\r\n]*)+/g ).filter( (p) => p.trim() );
        if (this.ifUseSecureProxiesOnly) {
          customProxyArray = customProxyArray.filter( (p) => !p.startsWith('HTTP ') );
        }
      }
      if (this.ifUseLocalTor) {
        customProxyArray.push('SOCKS5 localhost:9050', 'SOCKS5 localhost:9150');
      }

      if (customProxyArray.length) {
        this.customProxyArray = customProxyArray;
        this.filteredCustomsString = customProxyArray.join('; ');
      } else {
        if (!this.ifUsePacScriptProxies) {
          throw new TypeError('Нет ни одного прокси, удовлетворяющего вашим требованиям!');
        }
        this.customProxyArray = false;
        this.filteredCustomsString = '';
      }

    }

  };

  window.apis.pacKitchen = {

    getConfigs: getOrderedConfigsForUser,

    cook(pacData, pacMods = window.utils.mandatory()) {

      return pacMods.ifNoMods ? pacData : pacData + `${ kitchenStartsMark }
;+function(global) {
  "use strict";

  const originalFindProxyForURL = FindProxyForURL;
  global.FindProxyForURL = function(url, host) {
    ${function() {

      let res = '';
      if (pacMods.ifProxyHttpsUrlsOnly) {

        res = `
    if (!url.startsWith("https")) {
      return "DIRECT";
    }
`;
        if(
          !pacMods.ifUseSecureProxiesOnly &&
          !pacMods.filteredCustomsString &&
           pacMods.ifUsePacScriptProxies
        ) {
          return res + `
    return originalFindProxyForURL(url, host);`;
        }
      }

      return res + `
    const originalProxyString = originalFindProxyForURL(url, host);
    let originalProxyArray = originalProxyString.split(/(?:\\s*;\\s*)+/g).filter( (p) => p );
    if (originalProxyArray.every( (p) => /^DIRECT$/i.test(p) )) {
      // Directs only or null, no proxies.
      return originalProxyString;
    }
    return ` +
      function() {

        if (!pacMods.ifUsePacScriptProxies) {
          return '"' + pacMods.filteredCustomsString + '"';
        }
        let filteredOriginalsExp = 'originalProxyString';
        if (pacMods.ifUseSecureProxiesOnly) {
          filteredOriginalsExp =
            'originalProxyArray.filter( (p) => !p.toUpperCase().startsWith("HTTP ") ).join("; ")';
        }
        if ( !pacMods.filteredCustomsString ) {
          return filteredOriginalsExp;
        }
        return '"' + pacMods.filteredCustomsString + '; " + ' + filteredOriginalsExp;

      }() + ' + "; DIRECT";'; // Without DIRECT you will get 'PROXY CONN FAILED' pac-error.

    }()}

  };

}(this);`;

    },

    keepCookedNow(pacMods = window.utils.mandatory(), cb) {

      if (typeof(pacMods) === 'function') {
        cb = pacMods;
        const pacMods = getCurrentConfigs();
        if (!pacMods) {
          return cb(TypeError('PAC mods were never initialized.'));
        }
      } else {
        try {
          pacMods = new PacModifiers(pacMods);
        } catch(e) {
          return cb(e);
        }
        localStorage.setItem(kitchenStorageKey, JSON.stringify(pacMods));
      }
      chrome.proxy.settings.get({}, (details) => {

        if (
          details.levelOfControl === 'controlled_by_this_extension'
        ) {
          const pac = window.utils.getProp(details, 'value.pacScript');
          if (pac && pac.data) {
            // Delete old kitchen modifications.
            pac.data = pac.data.replace(
              new RegExp(kitchenStartsMark + '[\\s\\S]*$', 'g'),
              ''
            );
            return chrome.proxy.settings.set(details, cb);
          }
        }
        return cb(
          null,
          null,
          [new TypeError('PAC-скрипт не обнаружен, но настройки будут активированы при установке PAC-скрипта.')]
        );

      });

    },

    resetToDefaultsVoid() {

      delete localStorage[kitchenStorageKey];
      this.keepCookedNow({});

    },

  };

  const originalSet = chrome.proxy.settings.set.bind( chrome.proxy.settings );

  chrome.proxy.settings.set = function(details, cb) {

    const pac = window.utils.getProp(details, 'value.pacScript');
    if (!(pac && pac.data)) {
      return originalSet(details, cb);
    }
    const pacMods = getCurrentConfigs();
    if (pacMods) {
      pac.data = window.apis.pacKitchen.cook( pac.data, pacMods );
    }
    originalSet({ value: details.value }, cb);

  };

} // Private namespace ends.
