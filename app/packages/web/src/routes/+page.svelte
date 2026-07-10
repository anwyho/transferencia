<script lang="ts">
	// Import the isomorphic domain package on a real route — proves the web ↔ domain
	// package boundary is wired end-to-end (SSR + client). Replaced by the real
	// practice screen in slice A (#8).
	import { DOMAIN_READY, ping } from '@lt/domain';
</script>

<h1 data-testid="app-title">Language Transfer — practice</h1>
<p data-testid="domain-status">domain: {ping()} ({DOMAIN_READY ? 'ready' : 'not ready'})</p>
