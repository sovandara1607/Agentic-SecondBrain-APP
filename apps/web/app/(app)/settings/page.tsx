import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExportButton } from "@/components/export-button";
import { ApiTokensPanel } from "@/components/api-tokens-panel";
import { Trans } from "@/components/trans";
import { updateProfile, updateSchedulingPreferences } from "./actions";

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

type WorkingHours = { start?: string; end?: string; days?: number[] };
type EnergyProfile = { morning?: string; afternoon?: string; evening?: string };
type SchedulerWeights = { urgency?: number; priority?: number; project_weight?: number };

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { data: apiTokens }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, subscription_tier, working_hours, energy_profile, scheduler_weights")
      .eq("id", user!.id)
      .single(),
    supabase
      .from("api_tokens")
      .select("id, name, token_prefix, created_at, last_used_at, revoked_at")
      .order("created_at", { ascending: false }),
  ]);

  const workingHours = (profile?.working_hours as WorkingHours) ?? {};
  const energyProfile = (profile?.energy_profile as EnergyProfile) ?? {};
  const schedulerWeights = (profile?.scheduler_weights as SchedulerWeights) ?? {};
  const activeDays = new Set(workingHours.days ?? [1, 2, 3, 4, 5]);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold"><Trans id="settings" /></h1>
        <p className="text-sm text-muted-foreground">
          Your account and preferences.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Profile
            <Badge variant="muted">{profile?.subscription_tier ?? "free"}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateProfile} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={user?.email ?? ""} disabled />
            </div>
            <div className="space-y-1">
              <Label htmlFor="full_name">Full name</Label>
              <Input
                id="full_name"
                name="full_name"
                defaultValue={profile?.full_name ?? ""}
                placeholder="Your name"
              />
            </div>
            <SubmitButton pendingText="Saving..."><Trans id="save" /></SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scheduling preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateSchedulingPreferences} className="space-y-5">
            <p className="text-xs text-muted-foreground">
              Feeds the scheduling algorithm (Section 15): working hours and energy bound where
              tasks can be placed, weights decide which task wins a slot when several compete.
            </p>

            {/* Working hours */}
            <div className="space-y-2">
              <Label>Working hours</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  name="start_time"
                  defaultValue={workingHours.start ?? "09:00"}
                  className="w-auto"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="time"
                  name="end_time"
                  defaultValue={workingHours.end ?? "18:00"}
                  className="w-auto"
                />
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {DAYS.map((day) => (
                  <label key={day.value} className="cursor-pointer">
                    <input
                      type="checkbox"
                      name="days"
                      value={day.value}
                      defaultChecked={activeDays.has(day.value)}
                      className="peer sr-only"
                    />
                    <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-primary">
                      {day.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Energy profile */}
            <div className="space-y-2">
              <Label>Energy profile</Label>
              <p className="text-xs text-muted-foreground">
                When are you sharpest? Higher-energy tasks only get placed in slots tagged at
                least this level.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(["morning", "afternoon", "evening"] as const).map((period) => (
                  <div key={period} className="space-y-1">
                    <Label htmlFor={`energy_${period}`} className="text-xs capitalize text-muted-foreground">
                      {period}
                    </Label>
                    <Select
                      id={`energy_${period}`}
                      name={`energy_${period}`}
                      defaultValue={energyProfile[period] ?? "medium"}
                      className="w-full"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            {/* Scheduler weights */}
            <div className="space-y-2">
              <Label>Scheduler weights</Label>
              <p className="text-xs text-muted-foreground">
                How the placement score combines urgency, priority, and the parent project&apos;s
                weight. Values don&apos;t need to sum to 1, but it keeps them easy to reason
                about.
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="weight_urgency" className="text-xs text-muted-foreground">
                    Urgency
                  </Label>
                  <Input
                    id="weight_urgency"
                    name="weight_urgency"
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    defaultValue={schedulerWeights.urgency ?? 0.5}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="weight_priority" className="text-xs text-muted-foreground">
                    Priority
                  </Label>
                  <Input
                    id="weight_priority"
                    name="weight_priority"
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    defaultValue={schedulerWeights.priority ?? 0.3}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="weight_project" className="text-xs text-muted-foreground">
                    Project
                  </Label>
                  <Input
                    id="weight_project"
                    name="weight_project"
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    defaultValue={schedulerWeights.project_weight ?? 0.2}
                  />
                </div>
              </div>
            </div>

            <SubmitButton pendingText="Saving..."><Trans id="savePreferences" /></SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data export</CardTitle>
        </CardHeader>
        <CardContent>
          <ExportButton apiUrl={process.env.NEXT_PUBLIC_API_URL!} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API tokens</CardTitle>
        </CardHeader>
        <CardContent>
          <ApiTokensPanel tokens={apiTokens ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}
