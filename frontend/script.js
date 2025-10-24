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
// ───────────────────────────────────────────────
// ❤️ Local like helpers using localStorage
// Purpose: Store and retrieve which study spots
// the user has liked locally (persists across reloads)
// ───────────────────────────────────────────────
/**
 * getLiked()
 * Reads an array of liked spot IDs from localStorage.
 * Returns [] if nothing saved or if parsing fails.
 */
function getLiked(){
  try { return JSON.parse(localStorage.getItem('likedSpots') || '[]'); }
  catch { return []; } // fallback: return empty array
}
/**
 * saveLiked(arr)
 * Saves the provided array of liked IDs back to localStorage.
 */
function saveLiked(arr){
  localStorage.setItem('likedSpots', JSON.stringify(arr));
}
/**
 * getLikeCounts()
 * Reads an object of {spotId: count} from localStorage.
 */
function getLikeCounts(){
  try { return JSON.parse(localStorage.getItem('likeCounts') || '{}'); }
  catch { return {}; } // fallback: return empty object
}
/**
 * getLikeCount(id)
 * Returns the saved count for a given spot ID (defaults to 0).
 */
function getLikeCount(id){
  const all = getLikeCounts();
  return all[id] || 0;
}
/**
 * saveLikeCounts(obj)
 * Saves the like counts object back to localStorage.
 */
function saveLikeCounts(obj){
  localStorage.setItem('likeCounts', JSON.stringify(obj));
}
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

  // Use a unique key per spot (prefer its database ID, fallback = name)
  const key = spot.id || `spot:${spot.name}`;

  // Read current "liked" state and count from localStorage
  const liked = getLiked().includes(key);
  const count = getLikeCount(key);

  // Pick emoji based on like state
  const heart = liked ? "❤️" : "🤍";

  return `
  <div class="gm-popup">
    <h3>${spot.name}</h3>
    ${tags ? `<div class="gm-tags">${tags}</div>` : ""}
    <p>${spot.notes || ""}</p>
    ${spot.hours ? `<p class="gm-hours">🕒 ${hoursText}</p>` : ""}
    <button class="like-btn" data-id="${key}">
      ${heart} <span class="count">${count}</span>
    </button>
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
    // NEW: store for the sidebar
    allSpots = Array.isArray(spots) ? spots : [];
    if (side.classList.contains('open')) refreshList();

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
const origToggleList = toggleList;
toggleList = function(force){
  origToggleList(force);
  updateSidebarOffset();
};

// also run once on load
updateSidebarOffset();

// ─────────────────────────────────────────────────────────────────────────────
// Nearby list (sidebar)
// Shows the N closest spots to either the user's location (if granted) or
// the current map center. Clicking an item flies to the marker and opens it.
// ─────────────────────────────────────────────────────────────────────────────
let allSpots = [];             // holds spots from /api/spots
let userOrigin = null;         // {lat, lng} if geolocation allowed

// Cache the <ul> element that holds list items
const resultsList = document.getElementById('listResults');

/** gets distance in meters */
function getDistance(a, b){
  const R = 6371000; // earth radius in meters
  const toRad = d => d * Math.PI / 180; // translates degree to radians
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const s = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * fmtDistance(meters) -> "123 m" or "1.23 km"
 * Human-readable distance formatting for the sidebar.
 */
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
  if (!resultsList) return;
   // Pick the reference point: user location (if granted) else current map center
  const center = map.getCenter();
  const origin = userOrigin || { lat: center.lat, lng: center.lng };

  // Enrich each spot with a computed distance, sort by that distance, take top 30
  const rows = allSpots.map(s => {
    const d = getDistance(origin, { lat: s.lat, lng: s.lng });
    return { ...s, _dist: d };
  }).sort((a,b) => a._dist - b._dist).slice(0, 30); // top N nearby

  // Clear the list and render items
  resultsList.innerHTML = '';
  for (const s of rows){
    const li = document.createElement('li');
    li.className = 'list-item';
    li.setAttribute('role', 'listitem');

    // Show up to 4 tags for compactness
    const tags = (s.tags || []).slice(0,4).map(t => `<span class="tag">${t}</span>`).join(' ');
    
    li.innerHTML = `
      <div class="item-title">${s.name}</div>
      <div class="item-sub">
        <span class="item-dist">${fmtDistance(s._dist)}</span>
        ${tags ? `<span>${tags}</span>` : ''}
      </div>
    `;

    // When clicked, fly to the spot and open its popup (if marker exists)
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

    resultsList.appendChild(li);
  }
}

// Try to get the user's location once; if denied, silently fall back to map center.
// If permission is granted and the sidebar is open, refresh to show correct distances.
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

// Keep the list relevant as the user pans/zooms:
// Only rebuild when the sidebar is open (saves work when it’s hidden).
map.on('moveend', () => {
  if (side.classList.contains('open')) refreshList();
});

// ─────────────────────────────────────────────────────────────────────────────
// Fetch hook: capture /api/spots results so the sidebar has data to work with.
// NOTE: This intercepts calls made AFTER this code runs. If the initial fetch
// happens earlier in the file, prefer setting `allSpots` in that handler too.
// ─────────────────────────────────────────────────────────────────────────────
(function(){
  // Intercept the original fetch logic to store spots and index markers
  const originalFetch = fetch;
  
  // Only affects this specific endpoint
  fetch = function(resource, init){
    const result = originalFetch(resource, init);

    // Only intercept the spots endpoint (supports absolute or relative URLs)
    if (typeof resource === 'string' && resource.includes('/api/spots')) {
      result.then(async r => {
        // clone to read without disturbing the existing chain
        const clone = r.clone();
        try {
          const arr = await clone.json();
          allSpots = Array.isArray(arr) ? arr : [];
          // If the sidebar is already open, refresh once to show the new data
          if (side.classList.contains('open')) refreshList();
        } catch {
          // Ignore JSON errors—other fetch consumers will handle their own failures
        }
      }).catch(() => {
        // Swallow network errors here so we don't interfere with the original caller
      });
    }
    return result;
  };
})();

// ───────────────────────────────────────────────
// ❤️ Global click handler for like buttons
// Purpose: Toggle heart emoji and count in popups
// and update localStorage so it persists across reloads.
// ───────────────────────────────────────────────
document.addEventListener('click', (e) => {
  // Check if a click was on or inside a .like-btn element
  const btn = e.target.closest('.like-btn');
  if (!btn) return; // Ignore clicks elsewhere

  // Get the spot ID from button's data attribute
  const id = btn.dataset.id;

  // Load current liked IDs and counts from storage
  let liked = getLiked();
  let counts = getLikeCounts();
  counts[id] = counts[id] || 0;

  // Toggle like state
  if (liked.includes(id)) {
    // If already liked → unlike it
    liked = liked.filter(x => x !== id);
    counts[id] = Math.max(0, counts[id] - 1);
  } else {
    // If not liked yet → add like
    liked.push(id);
    counts[id]++;
  }

  // Save new state back to localStorage
  saveLiked(liked);
  saveLikeCounts(counts);

  // Immediately update the popup UI (emoji + number)
  btn.innerHTML = `${liked.includes(id) ? "❤️" : "🤍"} <span class="count">${counts[id]}</span>`;
});