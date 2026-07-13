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

	<section data-testid="scheduled-rules" aria-label="scheduled rules">
		<p>scheduled rules: <span data-testid="scheduled-count">{data.scheduledRules.length}</span></p>
		<ol data-testid="scheduled-list">
			{#each data.scheduledRules as r (r.ruleKey + '|' + r.direction)}
				<li data-testid="rule-state-row" data-rule-key={r.ruleKey} data-due-now={r.dueNow}>
					<span data-testid="rule-key">{r.ruleKey}</span>
					<span data-testid="rule-direction">{r.direction}</span>
					<span data-testid="rule-due-at">{r.dueAt}</span>
					<span data-testid="rule-due-now">{r.dueNow}</span>
					<span data-testid="rule-mastery">{r.mastery.toFixed(2)}</span>
					<span data-testid="rule-coverage">{r.coverage}</span>
					<span data-testid="rule-mastered">{r.mastered}</span>
				</li>
			{/each}
		</ol>
	</section>
</main>
