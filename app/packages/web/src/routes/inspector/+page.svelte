<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<main>
	<h1 data-testid="inspector-title">Queue inspector</h1>

	<section aria-label="lesson dial">
		<form method="POST" action="?/down" style="display: inline">
			<button data-testid="lesson-down" aria-label="lesson down">−</button>
		</form>
		<strong data-testid="current-lesson">{data.currentLesson}</strong>
		<span> / {data.maxLesson}</span>
		<form method="POST" action="?/up" style="display: inline">
			<button data-testid="lesson-up" aria-label="lesson up">+</button>
		</form>
		<form method="POST" action="?/set" style="display: inline">
			<input
				type="number"
				name="lesson"
				data-testid="lesson-input"
				min="1"
				max={data.maxLesson}
				value={data.currentLesson}
			/>
			<button data-testid="set-lesson">set</button>
		</form>
	</section>

	<section data-testid="queue" aria-label="eligible queue">
		<p>
			eligible items: <span data-testid="queue-count">{data.items.length}</span>
			· schedulable rules: <span data-testid="rule-count">{data.rules.length}</span>
		</p>
		<ol data-testid="queue-list">
			{#each data.items as item (item.id)}
				<li data-testid="queue-item" data-item-id={item.id}>
					<span data-testid="queue-item-lesson">L{item.min_lesson}</span>
					<span>{item.front_en} → {item.back_es}</span>
					<span>[{item.rule_keys.join(', ')}]</span>
				</li>
			{/each}
		</ol>
	</section>
</main>
