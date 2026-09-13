// ─────────────────────────────────────────────────────────────────────────────
// Base map setup (Leaflet + OSM)
// ─────────────────────────────────────────────────────────────────────────────
// sets map to USC location and zoomed to campus level
const map = L.map('map').setView([34.0219, -118.2858], 16); // USC

// tiles, creates the map
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
  referrerPolicy: 'strict-origin-when-cross-origin'
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
// Escapes user-provided text before inserting it into HTML
function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// Popup builder
function buildPopup(spot) {
  const safeName = escapeHTML(spot.name);
  const safeNotes = escapeHTML(spot.notes);

  const tags = (spot.tags || [])
    .map(tag => `<span>${escapeHTML(tag)}</span>`)
    .join('');

  // Figure out today's opening hours
  let hoursText = '';

  if (spot.hours) {
    const days = [
      'sun',
      'mon',
      'tue',
      'wed',
      'thu',
      'fri',
      'sat'
    ];

    const today = days[new Date().getDay()];
    const ranges = spot.hours[today] || [];

    hoursText = ranges.length
      ? ranges
          .map(range =>
            `${escapeHTML(range.open)}–${escapeHTML(range.close)}`
          )
          .join(', ')
      : 'Closed today';
  }

  return `
    <div class="gm-popup">
      <h3>${safeName}</h3>

      ${tags ? `<div class="gm-tags">${tags}</div>` : ''}

      <p>${safeNotes}</p>

      ${spot.hours
        ? `<p class="gm-hours">🕒 ${hoursText}</p>`
        : ''
      }

      <button
        class="like-btn"
        data-id="${escapeHTML(spot.id)}"
      >
        👍 Like (${Number(spot.likes) || 0})
      </button>
    </div>
  `;
}

// Sends a like request to the backend and updates the button
async function likeSpot(spotId, button) {
  try {
    const response = await fetch(`/api/spots/${spotId}/like`, {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error('Failed to like spot');
    }

    const data = await response.json();

    // Update the button text with the new like count
    button.textContent = `👍 Like (${data.likes})`;

    // Update the matching spot in local state
    const spot = allSpots.find(s => s.id === spotId);

    if (spot) {
      spot.likes = data.likes;
    }
  } catch (error) {
    console.error('Like error:', error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Data fetch + marker creation
// ─────────────────────────────────────────────────────────────────────────────
// Config
const API_BASE = '';

// State
let allSpots = [];             // holds spots from /api/spots
let visibleSpots = [];         // spots currently shown after search/filtering
let userOrigin = null;         // {lat, lng} if geolocation allowed

// Search and filter controls
const searchInput = document.getElementById('search');
const filterInputs = Array.from(document.querySelectorAll('.flt'));

// Fetches study spots from your local API and adds markers to the cluster.
// Flow:
//  1) GET /api/spots → JSON array of { id?, name, lat, lng, tags?, notes?, hours? }.
//  2) For each spot, create a marker, attach a popup, and insert into the cluster.
//  3) Future code: track marker by spot.id in markersById for quick lookups later.
// Errors: logs HTTP errors or network failures to the console.
fetch(`${API_BASE}/api/spots`)
  .then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  })
  .then(spots => {
    // NEW: store for the sidebar
    allSpots = Array.isArray(spots) ? spots : [];
    visibleSpots = [...allSpots];

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

// Apply the current search text and selected tag filters
function applySearchAndFilters() {
  // Start with every study spot
  let results = [...allSpots];

  // Get all checked filter tags
  const selectedTags = filterInputs
    .filter(input => input.checked)
    .map(input => input.value.toLowerCase());

  // Keep spots that contain every selected tag
  if (selectedTags.length > 0) {
    results = results.filter(spot => {
      const spotTags = (spot.tags || []).map(tag => tag.toLowerCase());

      return selectedTags.every(tag => spotTags.includes(tag));
    });
  }

  // Get the current search text
  const query = searchInput?.value.trim();

  // Use Fuse.js for fuzzy searching
  if (query) {
    const fuse = new Fuse(results, {
      keys: ['name', 'notes', 'tags'],
      threshold: 0.35,
      ignoreLocation: true
    });

    results = fuse.search(query).map(result => result.item);
  }

  // Save the currently visible spots
  visibleSpots = results;

  // Remove all markers from the cluster
  cluster.clearLayers();

  // Add only matching markers back to the map
  visibleSpots.forEach(spot => {
    const marker = markersById.get(spot.id);

    if (marker) {
      cluster.addLayer(marker);
    }
  });

  // Update the sidebar too
  if (side.classList.contains('open')) {
    refreshList();
  }
}

// Search while the user types
if (searchInput) {
  searchInput.addEventListener('input', applySearchAndFilters);
}

// Re-filter whenever a checkbox changes
filterInputs.forEach(input => {
  input.addEventListener('change', applySearchAndFilters);
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

// ───────── State ─────────
let addMode = false;
let tempMarker = null;
let pendingLatLng = null;

// ───────── Elements ─────────
const addBtn = document.getElementById('addSS');
const modal = document.getElementById('addSpotModal');
const form  = document.getElementById('addSpotForm');
const nameInput = document.getElementById('gmName');
const notesInput = document.getElementById('gmNotes');
const latEl = document.getElementById('gmLat');
const lngEl = document.getElementById('gmLng');

// Basic modal controls
function openModal() {
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => nameInput?.focus(), 0);
}
function closeModal() {
  modal.setAttribute('aria-hidden', 'true');
  form.reset();
}

// Close on backdrop / X / Cancel
modal.addEventListener('click', (e) => {
  if (e.target.matches('[data-closemodal]')) {
    exitAddMode(true);
  }
});

// Esc to close
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
    exitAddMode(true);
  }
});

// Button: enter/exit add mode
if (addBtn) {
  addBtn.addEventListener('click', () => {
    if (addMode) { exitAddMode(true); return; }
    enterAddMode();
  });
}

function enterAddMode() {
  addMode = true;
  addBtn.textContent = 'Click map to place spot…';
  addBtn.classList.add('is-armed');
  map.getContainer().style.cursor = 'crosshair';
}

function exitAddMode(clearTemp = false) {
  addMode = false;
  addBtn.textContent = '+ Add Spot';
  addBtn.classList.remove('is-armed');
  map.getContainer().style.cursor = '';
  if (clearTemp && tempMarker) {
    map.removeLayer(tempMarker);
    tempMarker = null;
  }
  pendingLatLng = null;
  closeModal();
}

// Map click: place marker, set coords, open modal
map.on('click', (e) => {
  if (!addMode) return;
  pendingLatLng = e.latlng;

  // show / move temp marker
  if (tempMarker) map.removeLayer(tempMarker);
  tempMarker = L.marker([e.latlng.lat, e.latlng.lng], { icon: studyIcon }).addTo(map);

  // push coords into hidden inputs
  latEl.value = String(e.latlng.lat);
  lngEl.value = String(e.latlng.lng);

  openModal();
});

// Submit form → POST /api/spots
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  // User must choose a location first
  if (!pendingLatLng) {
    alert('Click the map first to choose a location.');
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');

  submitBtn.classList.add('loading');
  submitBtn.disabled = true;

  // Collect selected tags
  const tags = Array.from(
    form.querySelectorAll('input[name="tags"]:checked')
  ).map(cb => cb.value);

  // Build the request body
  const payload = {
    name: nameInput.value.trim(),
    notes: notesInput.value.trim(),
    lat: Number(latEl.value),
    lng: Number(lngEl.value),
    tags
  };

  // Basic client-side validation
  if (!payload.name || payload.name.length < 2) {
    alert('Please provide a name (min 2 chars).');

    submitBtn.classList.remove('loading');
    submitBtn.disabled = false;

    return;
  }

  try {
    // Send the new study spot to the backend
    const response = await fetch(`${API_BASE}/api/spots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));

    // Stop if the server rejected the request
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    // New spots are pending until an admin approves them
    alert('Thanks! Your study spot was submitted for review.');

    // Clear the form
    form.reset();

    // Exit add mode and remove the temporary marker
    exitAddMode(true);

    // Reset temporary location state
    tempMarker = null;
    pendingLatLng = null;

  } catch (err) {
    console.error('Submit error:', err);

    alert('Submit failed. Please try again.');
  } finally {
    submitBtn.classList.remove('loading');
    submitBtn.disabled = false;
  }
});

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
// Shows the N closest spots to either the user's location (if granted) or
// the current map center. Clicking an item flies to the marker and opens it.
// ─────────────────────────────────────────────────────────────────────────────

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
  const rows = visibleSpots.map(s => {
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

//─────────────────────────────────────────────────────────────────────────────
// Form Attributes
//─────────────────────────────────────────────────────────────────────────────
const formElement = document.getElementById('addSpotModal');
const addButton = document.getElementById('addSS');

function openForm()  { 
  formElement.setAttribute('aria-hidden', 'false'); 
}

function closeForm() { 
  formElement.setAttribute('aria-hidden', 'true');  
}

// Close on backdrop / X / Cancel
formElement.addEventListener('click', (e) => {
  if (e.target.matches('[data-closeform]')) closeForm();
});

// Close on Esc
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && formElement.getAttribute('aria-hidden') === 'false') closeForm();
});

// Handles clicks on Like buttons inside map popups
document.addEventListener('click', event => {
  const button = event.target.closest('.like-btn');

  if (!button) return;

  const spotId = button.dataset.id;

  likeSpot(spotId, button);
});