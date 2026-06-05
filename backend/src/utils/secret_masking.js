export const maskSecret = (value, visiblePrefix = 4, visibleSuffix = 4) => {
  if (!value) return '';
  const raw = String(value);
  if (raw.length <= visiblePrefix + visibleSuffix) return '***';
  return `${raw.slice(0, visiblePrefix)}***${raw.slice(-visibleSuffix)}`;
};

export const maskProxyUrl = (value) => {
  if (!value) return value;

  try {
    const url = new URL(value);
    if (url.password) {
      url.password = '***';
    }
    return url.toString();
  } catch {
    return String(value).replace(/:\/\/([^:\s/@]+):([^@\s]+)@/, '://$1:***@');
  }
};

export const maskProxyRecord = (proxy) => {
  if (!proxy) return proxy;
  return {
    ...proxy,
    proxy_url: maskProxyUrl(proxy.proxy_url),
    resolved_proxy_url: maskProxyUrl(proxy.resolved_proxy_url)
  };
};
