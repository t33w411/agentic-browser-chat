(function () {
  const globalScopeForDomainConfig = globalThis;
  const existingNamespaceForDomainConfig = globalScopeForDomainConfig.ABChatShared || {};

  // Hardcoded feature-to-domain mapping.
  // Keys are feature IDs, values are arrays of hostnames the feature targets.
  // Example:
  // const domainFeaturesForDomainConfig = {
  //   "specialReader": ["docs.example.com", "wiki.example.com"]
  // };
  const domainFeaturesForDomainConfig = {};

  function normalizeHostnameForDomainConfig(hostnameForDomainConfig) {
    if (!hostnameForDomainConfig || typeof hostnameForDomainConfig !== "string") {
      return "";
    }
    return hostnameForDomainConfig.trim().toLowerCase();
  }

  function isFeatureEnabledForDomainForDomainConfig(featureIdForDomainConfig, hostnameForDomainConfig) {
    if (!featureIdForDomainConfig || !hostnameForDomainConfig) {
      return false;
    }

    const domainsForDomainConfig = domainFeaturesForDomainConfig[featureIdForDomainConfig];
    if (!Array.isArray(domainsForDomainConfig) || !domainsForDomainConfig.length) {
      return false;
    }

    const normalizedHostnameForDomainConfig = normalizeHostnameForDomainConfig(hostnameForDomainConfig);
    if (!normalizedHostnameForDomainConfig) {
      return false;
    }

    return domainsForDomainConfig.some(function (domainForDomainConfig) {
      return normalizeHostnameForDomainConfig(domainForDomainConfig) === normalizedHostnameForDomainConfig;
    });
  }

  function getDomainsForFeatureForDomainConfig(featureIdForDomainConfig) {
    if (!featureIdForDomainConfig) {
      return [];
    }

    const domainsForDomainConfig = domainFeaturesForDomainConfig[featureIdForDomainConfig];
    if (!Array.isArray(domainsForDomainConfig)) {
      return [];
    }

    return domainsForDomainConfig.slice();
  }

  function getFeaturesForDomainForDomainConfig(hostnameForDomainConfig) {
    const normalizedHostnameForDomainConfig = normalizeHostnameForDomainConfig(hostnameForDomainConfig);
    if (!normalizedHostnameForDomainConfig) {
      return [];
    }

    const matchingFeaturesForDomainConfig = [];
    var featureIdsForDomainConfig = Object.keys(domainFeaturesForDomainConfig);

    for (var indexForDomainConfig = 0; indexForDomainConfig < featureIdsForDomainConfig.length; indexForDomainConfig++) {
      var featureIdForDomainConfig = featureIdsForDomainConfig[indexForDomainConfig];
      if (isFeatureEnabledForDomainForDomainConfig(featureIdForDomainConfig, normalizedHostnameForDomainConfig)) {
        matchingFeaturesForDomainConfig.push(featureIdForDomainConfig);
      }
    }

    return matchingFeaturesForDomainConfig;
  }

  globalScopeForDomainConfig.ABChatShared = {
    ...existingNamespaceForDomainConfig,
    domainConfig: {
      isFeatureEnabledForDomain: isFeatureEnabledForDomainForDomainConfig,
      getDomainsForFeature: getDomainsForFeatureForDomainConfig,
      getFeaturesForDomain: getFeaturesForDomainForDomainConfig
    }
  };
})();
