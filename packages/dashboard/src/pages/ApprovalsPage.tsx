import { useCallback, useEffect, useState } from 'react';

interface ApprovalEntry {
  id: string;
  agentId: string;
  toolName: string;
  input: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied';
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  reason?: string;
}

type StatusFilter = 'all' | 'pending' | 'approved' | 'denied';

export function ApprovalsPage() {
  const [approvals, setApprovals] = useState<ApprovalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [denyReasonId, setDenyReasonId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState('');
  const [acting, setActing] = useState<string | null>(null);

  const fetchApprovals = useCallback(() => {
    setLoading(true);
    const params = filter === 'all' ? '' : `?status=${filter}`;
    fetch(`/api/v1/approvals${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setApprovals((data as { approvals: ApprovalEntry[] }).approvals ?? []);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  const submitDecision = async (id: string, decision: 'approved' | 'denied', reason?: string) => {
    setActing(id);
    try {
      const body: Record<string, unknown> = { decision };
      if (reason) body.reason = reason;
      const res = await fetch(`/api/v1/approvals/${id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      setDenyReasonId(null);
      setDenyReason('');
      fetchApprovals();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(null);
    }
  };

  const handleApprove = (id: string) => {
    void submitDecision(id, 'approved');
  };

  const handleDenyClick = (id: string) => {
    if (denyReasonId === id) {
      void submitDecision(id, 'denied', denyReason || undefined);
    } else {
      setDenyReasonId(id);
      setDenyReason('');
    }
  };

  const tabs: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'denied', label: 'Denied' },
  ];

  const statusBadge = (status: ApprovalEntry['status']) => {
    switch (status) {
      case 'pending':
        return 'bg-amber-50 text-amber-700 border border-amber-200';
      case 'approved':
        return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
      case 'denied':
        return 'bg-red-50 text-red-700 border border-red-200';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">Approval Inbox</h2>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
              filter === tab.key
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="text-center py-12 text-slate-400 text-sm">Loading approvals...</div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && approvals.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm">
          No approvals found for the selected filter.
        </div>
      )}

      {!loading && approvals.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-widest">
                  Agent ID
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-widest">
                  Tool Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-widest">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-widest">
                  Created At
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-widest">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {approvals.map((approval) => (
                <tr key={approval.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 truncate max-w-[10rem]">
                    {approval.agentId}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">{approval.toolName}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadge(approval.status)}`}
                    >
                      {approval.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                    {new Date(approval.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {approval.status === 'pending' ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleApprove(approval.id)}
                          disabled={acting === approval.id}
                          className="px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDenyClick(approval.id)}
                          disabled={acting === approval.id}
                          className="px-2.5 py-1 rounded-md text-xs font-medium bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors"
                        >
                          {denyReasonId === approval.id ? 'Confirm Deny' : 'Deny'}
                        </button>
                        {denyReasonId === approval.id && (
                          <input
                            type="text"
                            value={denyReason}
                            onChange={(e) => setDenyReason(e.target.value)}
                            placeholder="Reason (optional)"
                            className="px-2 py-1 text-xs border border-slate-200 rounded-md w-40 focus:outline-none focus:border-indigo-300"
                          />
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">
                        {approval.reason ? `Reason: ${approval.reason}` : '—'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
