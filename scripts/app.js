// Sample dataset - structure can match your fetched feed/JSON schema
const mockSignals = [
  {
    id: 1,
    title: "EU AI Act Enforcement Phase 2 Rules Released",
    domain: "Governance",
    impact: "High",
    region: "EU",
    date: "2026-08-10",
    summary: "Detailed guidelines on general-purpose AI (GPAI) model compliance and transparency requirements published."
  },
  {
    id: 2,
    title: "NIST Publishes Updated Safety Benchmarks for LLMs",
    domain: "Safety",
    impact: "Medium",
    region: "US",
    date: "2026-08-09",
    summary: "New evaluation standards targeting red-teaming, watermarking, and agentic workflows."
  },
  {
    id: 3,
    title: "Open-Weight Frontier Model Released with Technical Report",
    domain: "OpenSource",
    impact: "High",
    region: "Global",
    date: "2026-08-08",
    summary: "New model weights released with full training methodology and safety filter evaluations."
  }
];

function renderSignals(data) {
  const container = document.getElementById("signals-container");
  if (!container) return;

  if (data.length === 0) {
    container.innerHTML = `<div class="no-results">No developments match your selected criteria.</div>`;
    return;
  }

  container.innerHTML = data.map(item => `
    <article class="signal-card impact-${item.impact.toLowerCase()}">
      <div class="card-meta">
        <span class="badge domain-badge">${item.domain}</span>
        <span class="badge impact-badge ${item.impact.toLowerCase()}">${item.impact} Impact</span>
        <span class="date-stamp">${item.date}</span>
      </div>
      <h3>${item.title}</h3>
      <p>${item.summary}</p>
    </article>
  `).join('');
}

function applyFilters() {
  const query = document.getElementById("search-input").value.toLowerCase();
  const selectedDomain = document.getElementById("domain-filter").value;
  const selectedImpact = document.getElementById("impact-filter").value;

  const filtered = mockSignals.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(query) || item.summary.toLowerCase().includes(query);
    const matchesDomain = selectedDomain === "all" || item.domain === selectedDomain;
    const matchesImpact = selectedImpact === "all" || item.impact === selectedImpact;
    return matchesSearch && matchesDomain && matchesImpact;
  });

  renderSignals(filtered);
}

// Governance Modal Mechanics
const regionDetails = {
  EU: {
    title: "European Union AI Governance Stance",
    content: "<strong>Framework:</strong> EU AI Act (Risk-based classification)<br><br>Recent Focus: General-Purpose AI (GPAI) codes of practice, high-risk system registrations, and national supervisor coordination."
  },
  US: {
    title: "United States AI Governance Stance",
    content: "<strong>Framework:</strong> Executive Orders & NIST AI Risk Management Framework<br><br>Recent Focus: Compute threshold monitoring, safe deployment standards, and federal agency procurement guidelines."
  },
  UK: {
    title: "United Kingdom AI Governance Stance",
    content: "<strong>Framework:</strong> Context-specific, sector-led regulatory approach<br><br>Recent Focus: AI Safety Institute (AISI) pre-deployment model testing and cross-sector coordinator duties."
  }
};

function openGovernanceModal(regionCode) {
  const modal = document.getElementById("governance-modal");
  const title = document.getElementById("modal-region-title");
  const body = document.getElementById("modal-region-body");

  if (regionDetails[regionCode]) {
    title.innerText = regionDetails[regionCode].title;
    body.innerHTML = regionDetails[regionCode].content;
    modal.classList.add("active");
  }
}

function closeModal() {
  const modal = document.getElementById("governance-modal");
  if (modal) modal.classList.remove("active");
}

function closeGovernanceModal(e) {
  if (e.target.id === "governance-modal") {
    closeModal();
  }
}

// Initial Run
document.addEventListener("DOMContentLoaded", () => {
  renderSignals(mockSignals);
});
