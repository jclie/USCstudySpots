
// sets map to USC location and zoomed to campus level
const map = L.map('map').setView([34.0219, -118.2858], 16); // USC

// tiles, creates the map
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
}).addTo(map);

// marker icons
const studyIcon = L.icon({
    iconUrl: "assets/study icon.png",
    iconSize: [30, 30], // rendered size (w,h)
    iconAnchor: [15, 30],
    popupAnchor: [0, -30]
});

// Quick lookup by id -> Leaflet marker (useful for syncing with a sidebar list, filters, etc.)
const markersById = new Map();

// Group markers into clusters to keep the map tidy at lower zoom levels.
const cluster = L.markerClusterGroup({
  maxClusterRadius: 120,   // was 60 → easier to merge
  showCoverageOnHover: false,
  disableClusteringAtZoom: 18,
  spiderfyOnClick: true,
  iconCreateFunction: function (c) {
    const count = c.getChildCount();
    const tier = count >= 50 ? 'large' : (count >= 10 ? 'medium' : 'small');
    const html = '<div class="cluster cluster-' + tier + '"><span>' + count + '</span></div>';
    return L.divIcon({ html, className: 'custom-cluster', iconSize: [44,44] });
  }
}).addTo(map);

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
    <div class="popup">
      <h3>${spot.name}</h3>
      ${tags ? `<div class="popup-tags">${tags}</div>` : ""}
      ${spot.notes ? `<p>${spot.notes}</p>` : ""}
      ${spot.hours ? `<div class="popup-hours"><strong>Hours:</strong> <span>${hoursText}</span></div>` : ""}
    </div>
  `;
}

// create spots and add markers
fetch("data/spots.json")
  .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(spots => {
    console.log("Loaded spots:", spots); // should list your spots
    spots.forEach(spot => {
      L.marker([spot.lat, spot.lng], { icon: studyIcon })
        .bindPopup(buildPopup(spot))
        .addTo(cluster);
    });
    console.log("Cluster size:", cluster.getLayers().length); // should be >= spots.length + 3 (smoke test)
  })
  .catch(err => console.error("Failed to load spots:", err));

// Filters dropdown behavior 
(function () {
  // Button that opens/closes the filters panel, and the panel itself.
  const btn = document.getElementById('filtersBtn');
  const panel = document.getElementById('filtersPanel');

  // If either element is missing, bail silently.
  if (!btn || !panel) {
    return;
  }

  // Show the panel and wire up outside-click / Escape handlers.
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

  // Hide the panel and remove handlers to avoid leaks.
  const closePanel = () => {
    panel.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
  };

  // If the click is outside both the panel and the button, close it.
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

// sidebar controls
// Cache references to the sidebar, its open/close buttons.
const side = document.getElementById('sideList');
const listToggle = document.getElementById('listToggle');
const closeList = document.getElementById('closeList');

// button controls
if (listToggle) listToggle.addEventListener('click', () => toggleList());
if (closeList)  closeList.addEventListener('click', () => toggleList(false));

// toggle sidebar
function toggleList(force) {
  const show = typeof force === 'boolean' ? force : !side.classList.contains('open');
  side.classList.toggle('open', show);
  if (listToggle) listToggle.setAttribute('aria-pressed', String(show));
  if (show) refreshList();
}

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

// call on toggle + on resize
window.addEventListener('resize', updateSidebarOffset);

const _origToggleList = toggleList;
toggleList = function(force){
  _origToggleList(force);
  updateSidebarOffset();
};

// also run once on load
updateSidebarOffset();