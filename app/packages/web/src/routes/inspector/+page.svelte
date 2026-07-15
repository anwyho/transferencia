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

	<section data-testid="planned-queue" aria-label="planned session">
		<p data-testid="planned-note">
			Deterministic preview (fixed seed) — the live session's picks vary by session.
		</p>
		<p>planned attempts: <span data-testid="planned-count">{data.plannedQueue.length}</span></p>
		<ol data-testid="planned-list">
			{#each data.plannedQueue as p, i (i)}
				<li data-testid="planned-item" data-rule-key={p.ruleKey} data-item-id={p.itemId}>
					<span data-testid="plan-rule">{p.ruleKey}</span>
					<span data-testid="plan-item">{p.itemId}</span>
					<span data-testid="plan-direction">{p.direction}</span>
				</li>
			{/each}
		</ol>
	</section>

	<section data-testid="starred" aria-label="starred items">
		<p>starred: <span data-testid="starred-count">{data.starredItems.length}</span></p>
		<ul data-testid="starred-list">
			{#each data.starredItems as id (id)}
				<li data-testid="starred-item" data-item-id={id}>{id}</li>
			{/each}
		</ul>
	</section>

	<section data-testid="session-panel" aria-label="current session">
		{#if data.session}
			<p>session: <span data-testid="session-id">{data.session.id}</span></p>
			<p>
				realized: <span data-testid="session-realized">{data.session.realizedCount}</span>
				/ <span data-testid="session-target">{data.session.targetAttempts}</span>
			</p>
			<p>ended: <span data-testid="session-ended">{String(data.session.ended)}</span></p>
			<ol data-testid="session-redrill-list">
				{#each data.sessionRedrill as r, i (i)}
					<li data-testid="session-redrill-item" data-item-id={r.itemId}>
						{r.itemId}
						{r.direction}
					</li>
				{/each}
			</ol>
		{:else}
			<p data-testid="session-none">no active session</p>
		{/if}
	</section>
</main>
