<h1 align="center">Tesserafin Web</h1>
<h3 align="center">Web client for the <a href="https://github.com/tesserafin-project/tesserafin">Tesserafin</a> media server</h3>

---

Tesserafin Web is the frontend used for most of the clients available for end users, such as desktop browsers, Android, and iOS. It is the official web client for Tesserafin, a media server. We welcome all contributions and pull requests! If you have a larger feature in mind please open an issue so we can discuss the implementation before you start.

## Origin

Tesserafin Web is a fork of [Jellyfin Web](https://github.com/jellyfin/jellyfin-web), the web client of the [Jellyfin Project](https://jellyfin.org). All credit for the original design, architecture, and the vast majority of the codebase goes to the Jellyfin contributors. This project is distributed under the same license, GPL-2.0-or-later, in accordance with the terms of the original work. Tesserafin does not claim product or protocol compatibility with Jellyfin.

## Build Process

### Dependencies

- [Node.js](https://nodejs.org/en/download)
- npm (included in Node.js)

### Getting Started

1. Clone or download this repository.

   ```sh
   git clone https://github.com/tesserafin-project/tesserafin-web.git
   cd tesserafin-web
   ```

2. Install build dependencies in the project directory.

   ```sh
   npm install
   ```

3. Run the web client with webpack for local development.

   ```sh
   npm start
   ```

4. Build the client with sourcemaps available.

   ```sh
   npm run build:development
   ```

Review the [Contributing Guide](./CONTRIBUTING.md) for more information on our process and tech stack.
