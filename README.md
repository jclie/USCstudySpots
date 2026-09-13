# USC Study Spots

A full-stack web application for discovering, searching, and submitting study locations around the University of Southern California.

## Features

- Interactive Leaflet map with OpenStreetMap tiles
- Study spot markers and marker clustering
- Search study spots by name, notes, and tags
- Filter locations by study environment
- User geolocation and nearby spot discovery
- Persistent likes for study spots
- User-submitted study locations
- Moderation workflow for new submissions
- Admin dashboard for approving or rejecting pending spots
- SQLite database persistence
- Input validation with Zod
- API rate limiting
- Security headers with Helmet
- XSS-safe rendering of user-provided content
- Responsive interface

## Tech Stack

### Frontend
- HTML
- CSS
- JavaScript
- Leaflet
- OpenStreetMap
- Fuse.js

### Backend
- Node.js
- Express
- SQLite
- better-sqlite3
- Zod
- Helmet
- express-rate-limit

## Project Structure

```text
USC Study Spots/
├── backend/
│   ├── models/
│   ├── package.json
│   └── server.js
├── frontend/
│   ├── admin.css
│   ├── admin.html
│   ├── admin.js
│   ├── index.html
│   ├── script.js
│   └── styles.css
├── .env.example
├── .gitignore
└── README.md