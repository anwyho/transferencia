<script lang="ts">
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Revealing the hint is client state. A revealed hint caps the SRS rating at
	// Hard (domain rating policy) — the hidden field carries the flag to the server.
	let hintRevealed = $state(false);
</script>

<main>
	<h1 data-testid="app-title">Language Transfer — practice</h1>

	{#if data.prompt && data.itemId}
		{#if data.phase === 'redrill'}
			<p data-testid="redrill-badge" role="status">Reviewing a miss</p>
		{/if}
		<section data-testid="prompt">
			<p data-testid="instruction">{data.prompt.instruction}</p>
			<p data-testid="given">{data.prompt.given}</p>
		</section>

		{#if data.prompt.hintAvailable && data.hint}
			<div>
				<button type="button" data-testid="reveal-hint" onclick={() => (hintRevealed = true)}>
					Reveal hint
				</button>
				{#if hintRevealed}
					<p data-testid="hint-text">{data.hint}</p>
				{/if}
			</div>
		{/if}

		<form method="POST" action="?/submit" data-testid="answer-form">
			<input type="hidden" name="sessionId" value={data.sessionId} />
			<input type="hidden" name="itemId" value={data.itemId} />
			<input type="hidden" name="direction" value={data.direction} />
			<input type="hidden" name="hintRevealed" value={String(hintRevealed)} />
			<label>
				Your answer
				<input
					type="text"
					name="answer"
					data-testid="answer-input"
					autocomplete="off"
					autocapitalize="off"
					autocorrect="off"
					spellcheck="false"
				/>
			</label>
			<button type="submit" data-testid="submit">Submit</button>
		</form>

		<form method="POST" action={data.starred ? '?/unstar' : '?/star'} data-testid="star-form">
			<input type="hidden" name="itemId" value={data.itemId} />
			<button type="submit" data-testid="star-toggle" aria-pressed={data.starred}>
				{data.starred ? '★ starred' : '☆ star'}
			</button>
		</form>
	{:else}
		<section data-testid="idle">
			{#if data.summary}
				<div data-testid="session-summary">
					<p>Session done.</p>
					<p>attempts: <span data-testid="summary-attempts">{data.summary.attempts}</span></p>
					<p>correct: <span data-testid="summary-correct">{data.summary.correct}</span></p>
					<p>re-drilled: <span data-testid="summary-redrilled">{data.summary.redrilled}</span></p>
				</div>
			{/if}
			{#if data.canStart}
				<form method="POST" action="?/start" data-testid="start-form">
					<button type="submit" data-testid="start-session">
						{data.summary ? 'Start another session' : 'Start practicing'}
					</button>
				</form>
			{:else}
				<p data-testid="caught-up">
					All caught up — nothing to practice. Dial up a lesson in the inspector.
				</p>
			{/if}
		</section>
	{/if}

	{#if form && 'verdict' in form}
		<section data-testid="result">
			<p data-testid="verdict">{form.verdict}</p>
			{#if form.detail}
				<p data-testid="detail">{form.detail}</p>
			{/if}
			<p>rating: <span data-testid="rating">{form.rating}</span></p>
			<p>answer: <span data-testid="reveal">{form.correctAnswer}</span></p>
			<p>you typed: <span data-testid="your-answer">{form.answer}</span></p>
		</section>
	{/if}
</main>
