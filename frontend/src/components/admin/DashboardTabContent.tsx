import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const PIE_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#06b6d4'];

type Stats = { medias: number; episodes: number; liens: number; pendingJobs: number };
type RecentItem = { id: string; title: string; type: string; image: string | null; created_at: string };
type TypeCount = { type: string; count: number };

export default function DashboardTab({ stats, byType, recent }: { stats: Stats | null; byType: TypeCount[]; recent: RecentItem[] }) {
  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard title="Medias" value={stats?.medias ?? '...'} />
        <StatCard title="Episodes" value={stats?.episodes ?? '...'} />
        <StatCard title="Liens" value={stats?.liens ?? '...'} />
        <StatCard title="Jobs en attente" value={stats?.pendingJobs ?? '...'} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-7 mb-8">
        <Card className="col-span-1 lg:col-span-4">
          <CardHeader>
            <CardTitle>Medias par type</CardTitle>
          </CardHeader>
          <CardContent>
            {byType.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={byType}>
                  <XAxis dataKey="type" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground/50 text-sm">
                Chargement...
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-1 lg:col-span-3">
          <CardHeader>
            <CardTitle>Repartition</CardTitle>
          </CardHeader>
          <CardContent>
            {byType.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie data={byType} dataKey="count" nameKey="type" cx="50%" cy="50%" outerRadius={100} label={(entry: any) => `${entry.type} (${entry.count})`}>
                    {byType.map((item, i) => (
                      <Cell key={item.type} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground/50 text-sm">
                Chargement...
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Medias recents</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length > 0 ? (
            <div className="space-y-3">
              {recent.map((item) => (
                <div key={item.id} className="flex items-center gap-3 text-sm">
                  <div className="w-8 h-8 rounded bg-muted flex items-center justify-center text-[10px] uppercase text-muted-foreground overflow-hidden shrink-0">
                    {item.image ? (
                      <img src={item.image} alt="" className="w-full h-full object-cover" />
                    ) : (
                      item.type?.slice(0, 2)
                    )}
                  </div>
                  <span className="flex-1 truncate">{item.title}</span>
                  <Badge variant="outline" className="text-[10px]">{item.type}</Badge>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {item.created_at ? new Date(item.created_at).toLocaleDateString('fr-FR') : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-muted-foreground/50 text-sm">
              Chargement...
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function StatCard({ title, value }: { title: string; value: number | string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
