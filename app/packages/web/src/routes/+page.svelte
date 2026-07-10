<script lang="ts">
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Revealing the hint is client state. A revealed hint caps the SRS rating at
	// Hard (domain rating policy) — the hidden field carries the flag to the server.
	let hintRevealed = $state(false);
</script>

<main>
	<h1 data-testid="app-title">Language Transfer — practice</h1>

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

	<form method="POST" data-testid="answer-form">
		<input type="hidden" name="sessionId" value={data.sessionId} />
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

	{#if form}
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
