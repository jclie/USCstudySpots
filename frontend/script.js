// ─────────────────────────────────────────────────────────────────────────────
// Base map setup (Leaflet + OSM)
// ─────────────────────────────────────────────────────────────────────────────
// sets map to USC location and zoomed to campus level
const map = L.map('map').setView([34.0219, -118.2858], 16); // USC

// tiles, creates the map
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
}).addTo(map);

// ─────────────────────────────────────────────────────────────────────────────
// Marker icon configuration
// ─────────────────────────────────────────────────────────────────────────────
// Configures a reusable Leaflet Icon for "study spots"
const studyIcon = L.icon({
    iconUrl: "assets/study icon.png",
    iconSize: [30, 30], // rendered size (w,h)
    iconAnchor: [15, 30], // the pixel within the icon that "sits" on the marker's lat/lng
    popupAnchor: [0, -30] // where the popup originates relative to the iconAnchor
});

// Quick lookup by id -> Leaflet marker (useful for syncing with a sidebar list, filters, etc.)
const markersById = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// Marker clustering
// ─────────────────────────────────────────────────────────────────────────────
// Group markers into clusters to keep the map tidy at lower zoom levels.
const cluster = L.markerClusterGroup({
  maxClusterRadius: 120,  // larger radius makes clusters merge more aggressively.\
  showCoverageOnHover: false, 
  disableClusteringAtZoom: 18, // turn clusters off when users zoom in close
  spiderfyOnClick: true, // spreads overlapping markers for easier selection.
  // builds a custom cluster icon element based on how many markers are inside the cluster "c".
  iconCreateFunction: function (c) { // c (L.MarkerCluster) – exposes getChildCount()
    const count = c.getChildCount(); 
    const tier = count >= 50 ? 'large' : (count >= 10 ? 'medium' : 'small'); 
    const html = '<div class="cluster cluster-' + tier + '"><span>' + count + '</span></div>';
    return L.divIcon({ html, className: 'custom-cluster', iconSize: [44,44] }); // outputs a Leaflet divIcon with size & HTML for our tiered badge
  }
}).addTo(map);

// ─────────────────────────────────────────────────────────────────────────────
// Popup HTML builder
// ─────────────────────────────────────────────────────────────────────────────
/**
 * buildPopup(spot)
 * Purpose: Generate the markup shown when a marker is clicked.
 * Input:   spot: {
 *            name: string,
 *            notes?: string,
 *            tags?: string[],
 *            hours?: {
 *              sun|mon|...|sat?: {open:string, close:string}[]
 *            }
 *          }
 * Output:  string (HTML) — safe to pass into Leaflet's bindPopup().
 * Behavior:
 *  - Renders tags as pill elements if present.
 *  - Computes a "today" hours string from spot.hours using the browser's local
 *    weekday (0=Sun..6=Sat). If no hours today => "Closed today".
 */
// Popup builder
function buildPopup(spot) {
  const tags = (spot.tags || []).map(t => `<span class="tag">${t}</span>`).join("");
  let hoursText = "";
  if (spot.hours) {
    const days = ["sun","mon","tue","wed","thu","fri","sat"];
    const today = days[new Date().getDay()];
    const ranges = spot.hours[today] || [];
    hoursText = ranges.length ? ranges.map(r => `${r.open}–${r.close}`).join(", ") : "Closed today";
  }
  return `
  <div class="gm-popup">
    <h3>${spot.name}</h3>
    ${tags ? `<div class="gm-tags">${tags}</div>` : ""}
    <p>${spot.notes}</p>
    ${spot.hours ? `<p class="gm-hours">🕒 ${hoursText}</p>` : ""}
  </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data fetch + marker creation
// ─────────────────────────────────────────────────────────────────────────────
// Fetches study spots from your local API and adds markers to the cluster.
// Flow:
//  1) GET /api/spots → JSON array of { id?, name, lat, lng, tags?, notes?, hours? }.
//  2) For each spot, create a marker, attach a popup, and insert into the cluster.
//  3) Future code: track marker by spot.id in markersById for quick lookups later.
// Errors: logs HTTP errors or network failures to the console.
fetch('http://localhost:3000/api/spots')
  .then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  })
  .then(spots => {
    console.log('Loaded spots:', spots.length, spots[0]);
    spots.forEach(spot => {
      const marker = L.marker([spot.lat, spot.lng], { icon: studyIcon })
        .bindPopup(buildPopup(spot));

      // Keep a lookup if each spot has a unique id
      if (spot.id != null) {
        markersById.set(spot.id, marker);
      }

      marker.addTo(cluster);
    });
  })
  .catch(err => {
    console.error('API /api/spots failed:', err);
  });

// Filters dropdown behavior 
(function () {
  // Button that opens/closes the filters panel, and the panel itself.
  const btn = document.getElementById('filtersBtn');
  const panel = document.getElementById('filtersPanel');

  // If either element is missing, bail silently.
  if (!btn || !panel) {
    return;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // function openPanel()
  // Purpose: Open the filters panel, update ARIA state, focus the first control,
  //          and attach global listeners for outside-click and Escape key.
  // Notes:
  //  - Adds 'open' CSS class to reveal the panel.
  //  - Sets aria-expanded="true" for screen readers.
  //  - Focus management improves keyboard UX.
  //  - Document-level listeners are cleaned up in closePanel().
  // ───────────────────────────────────────────────────────────────────────────
  const openPanel = () => {
    panel.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');

    // Move focus into the panel for keyboard users
    const first = panel.querySelector('input,button,[tabindex]:not([tabindex="-1"])');
    if (first) first.focus({ preventScroll: true });

    // Close when clicking outside or pressing Escape.
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
  };

  // ────────────────────────────────────────────────────────────────────────────────────────
  // function closePanel()
  // Purpose: Hide the filters panel, revert ARIA state, and remove document-level listeners 
  // to prevent leaks and accidental triggers.
  // ────────────────────────────────────────────────────────────────────────────────────────
  const closePanel = () => {
    panel.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
  };

  // ───────────────────────────────────────────────────────────────────────────
  // function onDocClick(e)
  // Purpose: Detects clicks outside both the button and the panel to close
  //          the panel (typical click-away behavior).
  // Inputs:  e: MouseEvent
  // ───────────────────────────────────────────────────────────────────────────
  const onDocClick = (e) => {
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    closePanel();
  };

  // Close on Escape and return focus to the button
  const onKey = (e) => {
    if (e.key === 'Escape') {
      closePanel();
      btn.focus({ preventScroll: true });
    }
  };

  // Toggle open/close when the button is clicked.
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    panel.classList.contains('open') ? closePanel() : openPanel();
  });
})();

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar controls
// ─────────────────────────────────────────────────────────────────────────────
// Cache references to the sidebar, its open/close buttons.
const side = document.getElementById('sideList');
const listToggle = document.getElementById('listToggle');
const closeList = document.getElementById('closeList');

// button controls
if (listToggle) listToggle.addEventListener('click', () => toggleList());
if (closeList)  closeList.addEventListener('click', () => toggleList(false));

/**
 * toggleList(force?)
 * Purpose: Open/close the sidebar and keep ARIA state in sync.
 * Input:   force (boolean | undefined)
 *          - true  → open
 *          - false → close
 *          - undefined → toggle based on current state
 * Effects:
 *  - Toggles 'open' class on the sidebar element.
 *  - Updates aria-pressed on the toggle button for accessibility.
 *  - Calls refreshList() when opening to rebuild/refresh the visible list (assumes
 *    refreshList() exists elsewhere in your codebase).
 */
// toggle sidebar
function toggleList(force) {
  const show = typeof force === 'boolean' ? force : !side.classList.contains('open');
  side.classList.toggle('open', show);
  if (listToggle) listToggle.setAttribute('aria-pressed', String(show));
  if (show) refreshList();
}

/**
 * updateSidebarOffset()
 * Purpose: Keep centered UI elements (e.g., search/add controls) visually
 *          centered when the sidebar opens by shifting via a CSS variable.
 * Behavior:
 *  - Reads the current sidebar width when open.
 *  - If sidebar nearly covers the viewport (mobile), sets offset to 0 to avoid
 *    awkward horizontal shifting.
 *  - Writes --sidebar-offset on :root for use in CSS layout rules.
 * Notes:
 *  - Called on window resize and whenever the sidebar is toggled.
 */
// keep search/add group visually centered when sidebar is open
function updateSidebarOffset() {
  const root = document.documentElement;
  const isOpen = side && side.classList.contains('open');
  let w = 0;
  if (isOpen && side) {
    w = side.getBoundingClientRect().width;
    // if sidebar takes (nearly) full width (mobile), don't offset
    if (w >= window.innerWidth * 0.98) w = 0;
  }
  root.style.setProperty('--sidebar-offset', w + 'px');
}

// Recompute the offset when the viewport changes size.
window.addEventListener('resize', updateSidebarOffset);

// ─────────────────────────────────────────────────────────────────────────────
// Function wrapping to inject offset updates whenever toggleList runs.
// We save the original implementation, then reassign toggleList to a wrapper
// that calls the original and subsequently updates the CSS offset.
// This avoids duplicating offset logic in multiple call sites.
// ─────────────────────────────────────────────────────────────────────────────
const _origToggleList = toggleList;
toggleList = function(force){
  _origToggleList(force);
  updateSidebarOffset();
};

// also run once on load
updateSidebarOffset();

// ─────────────────────────────────────────────────────────────────────────────
// Nearby list (sidebar)
// ─────────────────────────────────────────────────────────────────────────────
let allSpots = [];             // holds spots from /api/spots
let userOrigin = null;         // {lat, lng} if geolocation allowed

// quick helpers
const listEl = document.getElementById('listResults');

/** Haversine distance in meters */
function haversine(a, b){
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const s = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function fmtDistance(m){
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m/1000).toFixed(2)} km`;
}

/**
 * refreshList()
 * Builds the nearby list:
 *  - origin: user geolocation if available; else map center
 *  - sorts by distance
 *  - shows name, distance, tags
 *  - clicking an item flies to marker and opens its popup
 */
function refreshList(){
  if (!listEl) return;
  // choose origin
  const center = map.getCenter();
  const origin = userOrigin || { lat: center.lat, lng: center.lng };

  const rows = allSpots.map(s => {
    const d = haversine(origin, { lat: s.lat, lng: s.lng });
    return { ...s, _dist: d };
  }).sort((a,b) => a._dist - b._dist).slice(0, 30); // top N nearby

  // render
  listEl.innerHTML = '';
  for (const s of rows){
    const li = document.createElement('li');
    li.className = 'list-item';
    li.setAttribute('role', 'listitem');

    const tags = (s.tags || []).slice(0,4).map(t => `<span class="tag">${t}</span>`).join(' ');
    li.innerHTML = `
      <div class="item-title">${s.name}</div>
      <div class="item-sub">
        <span class="item-dist">${fmtDistance(s._dist)}</span>
        ${tags ? `<span>${tags}</span>` : ''}
      </div>
    `;

    li.addEventListener('click', () => {
      // fly to marker, open popup
      const m = markersById.get(s.id);
      if (m) {
        map.flyTo([s.lat, s.lng], Math.max(map.getZoom(), 18), { duration: 0.6 });
        // ensure the marker is actually on the map (if clustered, this will spiderfy)
        m.openPopup();
      } else {
        // fallback
        map.flyTo([s.lat, s.lng], Math.max(map.getZoom(), 18), { duration: 0.6 });
      }
    });

    listEl.appendChild(li);
  }
}

// Try to get user location once; fall back to map center if denied
if ('geolocation' in navigator){
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userOrigin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (side.classList.contains('open')) refreshList();
    },
    () => { /* ignore errors; we'll use map center */ },
    { enableHighAccuracy: true, timeout: 6000, maximumAge: 300000 }
  );
}

// Rebuild the list when the map moves (only while sidebar is open)
map.on('moveend', () => {
  if (side.classList.contains('open')) refreshList();
});

// ─────────────────────────────────────────────────────────────────────────────
// Hook into your existing fetch: capture spots and build markersById
// (We lightly patch your earlier fetch handler here.)
// ─────────────────────────────────────────────────────────────────────────────
(function(){
  // Intercept the original fetch logic to store spots and index markers
  const originalFetch = fetch;
  // Only affects this specific endpoint
  fetch = function(resource, init){
    const result = originalFetch(resource, init);
    if (typeof resource === 'string' && resource.includes('/api/spots')) {
      result.then(async r => {
        // clone to read without disturbing the existing chain
        const clone = r.clone();
        try {
          const arr = await clone.json();
          allSpots = Array.isArray(arr) ? arr : [];
          // after initial data load, if the sidebar is open, render once
          if (side.classList.contains('open')) refreshList();
        } catch {}
      }).catch(() => {});
    }
    return result;
  };
})();