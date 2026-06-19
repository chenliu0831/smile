/**
 * Cold-start hero for the chat (UX revamp). Never a blank box: shows the dataset status,
 * a dual pathway (load your own / mention the sample), and starter-prompt chips that
 * teach the interaction model and let a user run a full analysis with one click — no
 * typing required (NN/g empty-states + dual-pathway guidance).
 */
export interface StarterPrompt {
  label: string;
  prompt: string;
}

const NO_DATASET_PROMPTS: StarterPrompt[] = [
  { label: "What can you do?", prompt: "What kinds of analysis and models can you build for me?" },
];

const DATASET_PROMPTS: StarterPrompt[] = [
  { label: "Summarize this dataset", prompt: "Summarize the dataset: its shape, columns, and any data-quality issues." },
  { label: "What can you predict?", prompt: "Looking at this dataset, what's the most useful thing you could predict, and why?" },
  { label: "Build the best model", prompt: "Run AutoML on this dataset and build the best model you can. Report the leaderboard." },
  { label: "Find 3 insights", prompt: "Find the three most important insights in this dataset." },
];

export function ChatWelcome({
  datasetName,
  canLoadDataset,
  onLoadDataset,
  onPrompt,
}: {
  datasetName: string | null;
  canLoadDataset: boolean;
  onLoadDataset: () => void;
  onPrompt: (prompt: string) => void;
}) {
  const hasData = !!datasetName;
  const chips = hasData ? DATASET_PROMPTS : NO_DATASET_PROMPTS;

  return (
    <div className="chat-welcome">
      <div className="welcome-hero">Hi, I'm Clair — your data-science analyst.</div>
      <div className="welcome-status">
        {hasData ? (
          <>📄 <strong>{datasetName}</strong> is loaded and ready to analyze.</>
        ) : (
          <>No dataset loaded yet. Load one to get started.</>
        )}
      </div>

      {!hasData && (
        <button
          className="welcome-cta"
          onClick={onLoadDataset}
          disabled={!canLoadDataset}
          title={canLoadDataset ? "Choose a dataset file" : "Available in the desktop app"}
        >
          Load a dataset
        </button>
      )}

      <div className="welcome-chips-label">{hasData ? "Try asking:" : "Or ask:"}</div>
      <div className="welcome-chips">
        {chips.map((c) => (
          <button key={c.label} className="welcome-chip" onClick={() => onPrompt(c.prompt)}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
