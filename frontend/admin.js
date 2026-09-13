const tokenInput = document.getElementById('adminToken');
const loadBtn = document.getElementById('loadBtn');
const pendingContainer = document.getElementById('pendingSpots');
const statusMessage = document.getElementById('statusMessage');

let adminToken = '';


// Escape text before inserting it into HTML
function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


// Load all pending study spots
async function loadPendingSpots() {
  adminToken = tokenInput.value.trim();

  if (!adminToken) {
    statusMessage.textContent = 'Please enter the admin token.';
    return;
  }

  statusMessage.textContent = 'Loading...';

  try {
    const response = await fetch('/api/admin/spots', {
      headers: {
        'x-admin-token': adminToken
      }
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Could not load pending spots');
    }

    renderPendingSpots(data);

    statusMessage.textContent =
      `${data.length} pending spot${data.length === 1 ? '' : 's'}.`;

  } catch (error) {
    console.error(error);

    statusMessage.textContent = error.message;
    pendingContainer.innerHTML = '';
  }
}


// Display pending spots
function renderPendingSpots(spots) {
  pendingContainer.innerHTML = '';

  if (spots.length === 0) {
    pendingContainer.innerHTML = '<p>No pending submissions.</p>';
    return;
  }

  spots.forEach(spot => {
    const card = document.createElement('article');

    card.className = 'spot-card';

    const tags = (spot.tags || [])
      .map(tag => `<span class="tag">${escapeHTML(tag)}</span>`)
      .join('');

    card.innerHTML = `
      <h3>${escapeHTML(spot.name)}</h3>

      <p>
        ${escapeHTML(spot.notes || 'No notes provided.')}
      </p>

      <div class="tags">
        ${tags}
      </div>

      <p class="coordinates">
        Latitude: ${Number(spot.lat).toFixed(5)}
        <br>
        Longitude: ${Number(spot.lng).toFixed(5)}
      </p>

      <div class="actions">
        <button
          class="approve-btn"
          data-id="${escapeHTML(spot.id)}"
        >
          Approve
        </button>

        <button
          class="reject-btn"
          data-id="${escapeHTML(spot.id)}"
        >
          Reject
        </button>
      </div>
    `;

    pendingContainer.appendChild(card);
  });
}


// Approve or reject one spot
async function reviewSpot(spotId, action) {
  try {
    const response = await fetch(
      `/api/admin/spots/${encodeURIComponent(spotId)}/${action}`,
      {
        method: 'POST',

        headers: {
          'x-admin-token': adminToken
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Could not ${action} spot`);
    }

    // Reload pending spots after reviewing one
    await loadPendingSpots();

  } catch (error) {
    console.error(error);

    statusMessage.textContent = error.message;
  }
}


// Load button
loadBtn.addEventListener('click', loadPendingSpots);


// Approve / Reject buttons
pendingContainer.addEventListener('click', event => {
  const approveButton = event.target.closest('.approve-btn');
  const rejectButton = event.target.closest('.reject-btn');

  if (approveButton) {
    reviewSpot(approveButton.dataset.id, 'approve');
  }

  if (rejectButton) {
    reviewSpot(rejectButton.dataset.id, 'reject');
  }
});