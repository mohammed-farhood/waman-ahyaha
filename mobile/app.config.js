// app.json holds the real (store) config; this file only decides the platforms.
// WEB_PREVIEW=1 adds a browser target used for automated screenshots of the screens — it never ships.
module.exports = ({ config }) =>
  process.env.WEB_PREVIEW === '1'
    ? { ...config, platforms: ['ios', 'android', 'web'], web: { output: 'single', bundler: 'metro' } }
    : { ...config, platforms: ['ios', 'android'] };
