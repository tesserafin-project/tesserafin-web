const tv = new URLSearchParams(window.location.search).get('layout') === 'tv';
export default { tv, mobile: false };
