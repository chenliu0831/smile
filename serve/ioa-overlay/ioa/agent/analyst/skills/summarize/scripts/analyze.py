# OVERLAY COPY — DO NOT treat as original source.
#
# This is a near-verbatim copy of the `summarize` skill's analyze.py from the vendored
# ioa-agent jar, carried in serve/ioa-overlay/ so the daemon can shadow the jar's copy
# via PYTHONPATH (the overlay dir is placed AHEAD of the jar; `ioa` is a PEP-420
# namespace package, so Python merges the two and prefers this file).
#
# The ONLY change from upstream is line ~98: `select_dtypes(include=['str'])` →
# `include=['object']`. The upstream form raises under pandas>=2 / numpy>=2
# ("TypeError: numpy string dtypes are not allowed, use 'str' or 'object' instead"),
# crashing the summarize skill on its categorical-analysis step. `'object'` selects the
# same string columns and is version-safe.
#
# If you re-vendor a newer ioa-agent jar, diff this file against the jar's analyze.py and
# either drop this overlay (if upstream fixed it) or re-apply the one-line change.
import os
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

def read_tabular_data(file_path, **kwargs):
    """
    Reads tabular data based on file extension using Pandas.
    Supported: .csv, .parquet, .xlsx, .xls, .json, .feather
    """
    # Extract extension and convert to lowercase
    _, ext = os.path.splitext(file_path)
    ext = ext.lower()

    # Mapping extensions to pandas functions
    if ext == '.csv':
        return pd.read_csv(file_path, **kwargs)
    elif ext == '.parquet':
        return pd.read_parquet(file_path, **kwargs)
    elif ext in ['.xlsx', '.xls']:
        return pd.read_excel(file_path, **kwargs)
    elif ext == '.json':
        return pd.read_json(file_path, **kwargs)
    elif ext == '.feather':
        return pd.read_feather(file_path, **kwargs)
    elif ext in ['.txt', '.tsv']:
        # Defaulting to read_csv with tab separator for TSV
        kwargs.setdefault('sep', '\t')
        return pd.read_csv(file_path, **kwargs)
    else:
        raise ValueError(f"Unsupported file extension: {ext}")


def summarize_tabular(file_path, **kwargs):
    """
    Comprehensively analyzes a tabular data file and generates multiple visualizations.

    Args:
        file_path (str): Path to the tabular data file

    Returns:
        str: Formatted comprehensive analysis of the dataset
    """
    df = read_tabular_data(file_path, **kwargs)
    summary = []
    charts_created = []

    # Basic info
    summary.append("=" * 60)
    summary.append("📊 DATA OVERVIEW")
    summary.append("=" * 60)
    summary.append(f"Rows: {df.shape[0]:,} | Columns: {df.shape[1]}")
    summary.append(f"\nColumns: {', '.join(df.columns.tolist())}")

    # Data types
    summary.append(f"\n📋 DATA TYPES:")
    for col, dtype in df.dtypes.items():
        summary.append(f"  • {col}: {dtype}")

    # Missing data analysis
    missing = df.isnull().sum().sum()
    missing_pct = (missing / (df.shape[0] * df.shape[1])) * 100
    summary.append(f"\n🔍 DATA QUALITY:")
    if missing:
        summary.append(f"Missing values: {missing:,} ({missing_pct:.2f}% of total data)")
        summary.append("Missing by column:")
        for col in df.columns:
            col_missing = df[col].isnull().sum()
            if col_missing > 0:
                col_pct = (col_missing / len(df)) * 100
                summary.append(f"  • {col}: {col_missing:,} ({col_pct:.1f}%)")
    else:
        summary.append("✓ No missing values - dataset is complete!")

    # Numeric analysis
    numeric_cols = df.select_dtypes(include='number').columns.tolist()
    if numeric_cols:
        summary.append(f"\n📈 NUMERICAL ANALYSIS:")
        summary.append(str(df[numeric_cols].describe()))

        # Correlations if multiple numeric columns
        if len(numeric_cols) > 1:
            summary.append(f"\n🔗 CORRELATIONS:")
            corr_matrix = df[numeric_cols].corr()
            summary.append(str(corr_matrix))

            # Create correlation heatmap
            plt.figure(figsize=(10, 8))
            sns.heatmap(corr_matrix, annot=True, cmap='coolwarm', center=0,
                       square=True, linewidths=1)
            plt.title('Correlation Heatmap')
            plt.tight_layout()
            plt.savefig('correlation_heatmap.png', dpi=150)
            plt.close()
            charts_created.append('correlation_heatmap.png')

    # Categorical analysis
    categorical_cols = df.select_dtypes(include=['object']).columns.tolist()
    categorical_cols = [c for c in categorical_cols if 'id' not in c.lower()]

    if categorical_cols:
        summary.append(f"\n📊 CATEGORICAL ANALYSIS:")
        for col in categorical_cols[:5]:  # Limit to first 5
            value_counts = df[col].value_counts()
            summary.append(f"\n{col}:")
            for val, count in value_counts.head(10).items():
                pct = (count / len(df)) * 100
                summary.append(f"  • {val}: {count:,} ({pct:.1f}%)")

    # Time series analysis
    date_cols = [c for c in df.columns if 'date' in c.lower() or 'time' in c.lower()]
    if date_cols:
        summary.append(f"\n📅 TIME SERIES ANALYSIS:")
        date_col = date_cols[0]
        df[date_col] = pd.to_datetime(df[date_col], errors='coerce')

        date_range = df[date_col].max() - df[date_col].min()
        summary.append(f"Date range: {df[date_col].min()} to {df[date_col].max()}")
        summary.append(f"Span: {date_range.days} days")

        # Create time-series plots for numeric columns
        if numeric_cols:
            fig, axes = plt.subplots(min(3, len(numeric_cols)), 1,
                                    figsize=(12, 4 * min(3, len(numeric_cols))))
            if len(numeric_cols) == 1:
                axes = [axes]

            for idx, num_col in enumerate(numeric_cols[:3]):
                ax = axes[idx] if len(numeric_cols) > 1 else axes[0]
                daily_data = df.groupby(date_col)[num_col].agg(['mean', 'sum', 'count'])
                daily_data['mean'].plot(ax=ax, label='Average', linewidth=2)
                ax.set_title(f'{num_col} Over Time')
                ax.set_xlabel('Date')
                ax.set_ylabel(num_col)
                ax.legend()
                ax.grid(True, alpha=0.3)

            plt.tight_layout()
            plt.savefig('time_series_analysis.png', dpi=150)
            plt.close()
            charts_created.append('time_series_analysis.png')

    # Distribution plots for numeric columns
    if numeric_cols:
        n_cols = min(4, len(numeric_cols))
        fig, axes = plt.subplots(2, 2, figsize=(12, 10))
        axes = axes.flatten()

        for idx, col in enumerate(numeric_cols[:4]):
            axes[idx].hist(df[col].dropna(), bins=30, edgecolor='black', alpha=0.7)
            axes[idx].set_title(f'Distribution of {col}')
            axes[idx].set_xlabel(col)
            axes[idx].set_ylabel('Frequency')
            axes[idx].grid(True, alpha=0.3)

        # Hide unused subplots
        for idx in range(len(numeric_cols[:4]), 4):
            axes[idx].set_visible(False)

        plt.tight_layout()
        plt.savefig('distributions.png', dpi=150)
        plt.close()
        charts_created.append('distributions.png')

    # Categorical distributions
    if categorical_cols:
        fig, axes = plt.subplots(2, 2, figsize=(14, 10))
        axes = axes.flatten()

        for idx, col in enumerate(categorical_cols[:4]):
            value_counts = df[col].value_counts().head(10)
            axes[idx].barh(range(len(value_counts)), value_counts.values)
            axes[idx].set_yticks(range(len(value_counts)))
            axes[idx].set_yticklabels(value_counts.index)
            axes[idx].set_title(f'Top Values in {col}')
            axes[idx].set_xlabel('Count')
            axes[idx].grid(True, alpha=0.3, axis='x')

        # Hide unused subplots
        for idx in range(len(categorical_cols[:4]), 4):
            axes[idx].set_visible(False)

        plt.tight_layout()
        plt.savefig('categorical_distributions.png', dpi=150)
        plt.close()
        charts_created.append('categorical_distributions.png')

    # Summary of visualizations
    if charts_created:
        summary.append(f"\n📊 VISUALIZATIONS CREATED:")
        for chart in charts_created:
            summary.append(f"  ✓ {chart}")

    summary.append("\n" + "=" * 60)
    summary.append("✅ COMPREHENSIVE ANALYSIS COMPLETE")
    summary.append("=" * 60)

    return "\n".join(summary)


if __name__ == "__main__":
    # Test with sample data
    import sys
    if len(sys.argv) > 1:
        file_path = sys.argv[1]
        print(summarize_tabular(file_path))
    else:
        sys.exit("Error: No input file provided.")

