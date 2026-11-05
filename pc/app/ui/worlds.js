// Facts about the Sun, the Moon and the planets, for the panel that opens when you visit one.
// Figures are rounded, from NASA's planetary fact sheets. Moon counts are "known" moons and keep growing.
(function (root) {
  'use strict';
  const PSALM = { text: 'The heavens declare the glory of God; and the firmament sheweth his handywork.', ref: 'Psalm 19:1', book: 18, chapter: 19 };
  const LIGHTS = { text: 'And God made two great lights; the greater light to rule the day, and the lesser light to rule the night: he made the stars also.', ref: 'Genesis 1:16', book: 0, chapter: 1 };

  const W = {
    sun: {
      name: 'The Sun', what: 'Our star', verse: LIGHTS,
      facts: [['Across', '864,900 mi'], ['Turns once', 'about 27 days'], ['Surface', 'about 10,000 °F'], ['Core', 'about 27 million °F'], ['Age', 'about 4.6 billion years'], ['Gravity', '28× Earth']],
      note: 'About 1.3 million Earths would fit inside it, and it holds 99.8% of all the mass in the solar system.'
    },
    moon: {
      name: 'The Moon', what: 'Earth’s only natural moon', verse: LIGHTS,
      facts: [['Across', '2,159 mi'], ['Day to day', '29½ days'], ['Around Earth', '27⅓ days'], ['Gravity', '0.17× Earth'], ['Temperature', '−280 to 250 °F'], ['Visited', '12 people, 1969–72']],
      note: 'It turns exactly once for every trip around us, so it always shows us the same face.'
    },
    mercury: {
      name: 'Mercury', what: 'The smallest planet · first from the Sun', verse: PSALM,
      facts: [['Across', '3,032 mi'], ['A day (sunrise to sunrise)', '176 Earth days'], ['A year', '88 days'], ['Moons', 'none'], ['Gravity', '0.38× Earth'], ['Temperature', '−290 to 800 °F']],
      note: 'It goes around the Sun twice for every three turns, so one of its days lasts two of its years.'
    },
    venus: {
      name: 'Venus', what: 'Earth’s near-twin · second from the Sun', verse: PSALM,
      facts: [['Across', '7,521 mi'], ['A day', '117 Earth days'], ['A year', '225 days'], ['Moons', 'none'], ['Gravity', '0.91× Earth'], ['Temperature', 'about 870 °F']],
      note: 'The hottest planet, under clouds of sulfuric acid. It spins backward, so the Sun rises in the west.'
    },
    mars: {
      name: 'Mars', what: 'The red planet · fourth from the Sun', verse: PSALM,
      facts: [['Across', '4,212 mi'], ['A day', '24 h 40 min'], ['A year', '687 days'], ['Moons', '2: Phobos, Deimos'], ['Gravity', '0.38× Earth'], ['Temperature', 'about −85 °F']],
      note: 'Home to Olympus Mons, a volcano about two and a half times as tall as Mount Everest.'
    },
    jupiter: {
      name: 'Jupiter', what: 'The largest planet · fifth from the Sun', verse: PSALM,
      facts: [['Across', '86,881 mi'], ['A day', '9 h 56 min'], ['A year', '11.9 years'], ['Moons', 'more than 90'], ['Gravity', '2.5× Earth'], ['Cloud tops', 'about −160 °F']],
      note: 'More than 1,300 Earths would fit inside, and its Great Red Spot is a storm wider than our whole planet.'
    },
    saturn: {
      name: 'Saturn', what: 'The ringed planet · sixth from the Sun', verse: PSALM,
      facts: [['Across', '72,367 mi'], ['A day', '10 h 33 min'], ['A year', '29.4 years'], ['Moons', 'more than 270'], ['Gravity', '1.1× Earth'], ['Cloud tops', 'about −220 °F']],
      note: 'Its rings are mostly ice, about 175,000 miles across but in places only about 30 feet thick.'
    },
    uranus: {
      name: 'Uranus', what: 'The tipped-over ice giant · seventh from the Sun', verse: PSALM,
      facts: [['Across', '31,518 mi'], ['A day', '17 h 14 min'], ['A year', '84 years'], ['Moons', 'nearly 30'], ['Gravity', '0.9× Earth'], ['Cloud tops', 'about −320 °F']],
      note: 'It spins on its side, so each pole gets about 42 years of sunlight and then 42 years of dark.'
    },
    neptune: {
      name: 'Neptune', what: 'The windiest planet · eighth from the Sun', verse: PSALM,
      facts: [['Across', '30,599 mi'], ['A day', '16 h 6 min'], ['A year', '165 years'], ['Moons', '16'], ['Gravity', '1.1× Earth'], ['Cloud tops', 'about −330 °F']],
      note: 'Found by mathematics before anyone saw it; its winds blow at well over 1,000 miles an hour.'
    }
  };

  const RAD = Math.PI / 180;
  const DIRS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

  /** Right now: distance, light time, how much is lit, and where it is in the sky from a place. */
  function live(sky, id, lat, lon) {
    const b = sky.bodies.filter(function (x) { return x.id === id; })[0];
    if (!b) return null;
    const miles = b.dist * 92955807;
    const toEarth = [-b.pos[0] / b.dist, -b.pos[1] / b.dist, -b.pos[2] / b.dist];
    const lit = id === 'sun' ? 1 : (1 + b.sunward[0] * toEarth[0] + b.sunward[1] * toEarth[1] + b.sunward[2] * toEarth[2]) / 2;
    const H = (sky.gmst + lon - b.ra) * RAD, d = b.dec * RAD, p = lat * RAD;
    const alt = Math.asin(Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H)) / RAD;
    const az = (Math.atan2(-Math.cos(d) * Math.sin(H), Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.sin(p) * Math.cos(H)) / RAD + 360) % 360;
    return { miles: miles, au: b.dist, lightSec: b.dist * 499.005, lit: lit, alt: alt, az: az, dir: DIRS[Math.round(az / 45) % 8] };
  }

  function bigMiles(m) {
    if (m >= 1e9) return (m / 1e9).toFixed(m >= 1e10 ? 1 : 2) + ' billion miles';
    if (m >= 1e6) return Math.round(m / 1e6).toLocaleString('en-US') + ' million miles';
    return Math.round(m / 100) * 100 >= 1000 ? (Math.round(m / 100) * 100).toLocaleString('en-US') + ' miles' : Math.round(m) + ' miles';
  }

  function lightText(sec) {
    if (sec < 60) return sec.toFixed(1) + ' seconds';
    const m = Math.round(sec / 60);
    if (m < 90) return m + ' minutes';
    const h = Math.floor(m / 60), mm = m % 60;
    return h + ' h ' + mm + ' min';
  }

  const api = { W: W, live: live, bigMiles: bigMiles, lightText: lightText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FocusWorlds = api;
})(this);
