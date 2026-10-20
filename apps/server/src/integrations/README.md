# Server-only music engine boundary

`navidrome.ts` implements the documented Subsonic 1.16.1 read-only catalog API.
Requests use salted token authentication in POST bodies. A fetch implementation
can be injected for automated tests. Only selected public DTO fields leave this
boundary; raw upstream errors, credentials, URLs, paths, and headers do not.

Library routes expose fixed catalog/search/artwork operations only. No stream,
download, filesystem browsing, admin mutation, or arbitrary proxy endpoint exists.
The configured loopback Navidrome reads original music under read-only isolation.
All library routes now require an active Freeqify account, with plugin-level and
central checks. Keep local-only networking until a separate deployment phase.
