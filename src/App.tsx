import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowDownRight,
  ArrowRight,
  Archive,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Home,
  LogOut,
  Moon,
  Package,
  Palette,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShoppingBasket,
  Sparkles,
  Sun,
  UsersRound,
  Utensils,
} from "lucide-react";
import CookingMode from "./features/recipes/CookingMode";
import PantryPage, { type PantryItemSaveInput } from "./features/pantry/PantryPage";
import RecipeDetail from "./features/recipes/RecipeDetail";
import RecipeArtwork from "./features/recipes/RecipeArtwork";
import RecipeEditor, { type RecipePayload } from "./features/recipes/RecipeEditor";
import { addDays, formatDateKey, formatQuantity, localDateKey, mondayOf } from "./lib/format";
import { chooseRecipesForWeek, type PlannedDay, type RecipeUsage } from "./lib/meal-planning";
import { serializeMealPlan } from "./lib/meal-plan-payload";
import { averageRating } from "./lib/ratings";
import { comparePantryAvailability } from "./lib/pantry-matching";
import { pantryErrorMessage } from "./lib/pantry-errors";
import { preparePantryImage } from "./lib/pantry-images";
import { isShoppingListComplete } from "./lib/shopping-archive";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { readSavedDarkMode, saveDarkMode, UI_THEME } from "./lib/ui-themes";
import type { AppView, ArchivedShoppingList, Household, HouseholdRole, MealPlan, PantryItem, Recipe, ShoppingItem } from "./types";

const PANTRY_IMAGE_BUCKET = "pantry-images";

const viewLabels: Record<AppView, string> = {
  home: "Heute",
  plan: "Wochenplan",
  recipes: "Rezepte",
  shopping: "Einkaufsliste",
  pantry: "Vorräte",
};

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Das hat leider nicht geklappt. Bitte versuche es noch einmal.";
}

async function functionErrorText(error: unknown): Promise<string> {
  if (error && typeof error === "object" && "context" in error && error.context instanceof Response) {
    try {
      const details: unknown = await error.context.clone().json();
      if (details && typeof details === "object" && "error" in details && typeof details.error === "string") {
        return details.error;
      }
    } catch {
      return errorText(error);
    }
  }
  return errorText(error);
}

function weekDates(weekStart: string): PlannedDay[] {
  return Array.from({ length: 7 }, (_, index) => ({
    date: addDays(weekStart, index),
    excluded: false,
  }));
}

function pantrySummary(item: ShoppingItem, pantryItems: PantryItem[]): string | null {
  const availability = comparePantryAvailability(item, pantryItems);
  if (!availability.hasNameMatch) return null;
  if (!availability.hasCompatibleUnit) return "Vorrat vorhanden · Einheit prüfen";
  if (!availability.availableQuantity) return null;
  const inStock = formatQuantity(availability.availableQuantity, item.unit);
  if (availability.amountToBuy === null) return `Im Vorrat: ${inStock}`;
  if (availability.fullyAvailable) return `Vorrat reicht · ${inStock} vorhanden`;
  if (availability.availableQuantity > 0) {
    return `Vorrat: ${inStock} · noch ${formatQuantity(availability.amountToBuy, item.unit)} kaufen`;
  }
  return null;
}

function localName(email: string | undefined, username?: unknown): string {
  if (typeof username === "string" && username.trim()) return username.trim();
  if (!email) return "Kochfreund";
  return email.split("@")[0].replace(/[._-]+/g, " ").trim();
}

function AuthScreen({ client }: { client: NonNullable<typeof supabase> }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (identifier.includes("@")) {
        const { error: signInError } = await client.auth.signInWithPassword({ email: identifier.trim(), password });
        if (signInError) throw signInError;
      } else {
        const { data, error: loginError } = await client.functions.invoke<{
          session?: Pick<Session, "access_token" | "refresh_token">;
        }>("login-with-username", { body: { username: identifier.trim(), password } });
        if (loginError) throw new Error(await functionErrorText(loginError));
        if (!data?.session) throw new Error("Anmeldung fehlgeschlagen. Bitte versuche es erneut.");
        const { error: sessionError } = await client.auth.setSession(data.session);
        if (sessionError) throw sessionError;
      }
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function sendReset() {
    if (!identifier.includes("@")) {
      setError("Gib zum Zurücksetzen bitte deine E-Mail-Adresse ein.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: resetError } = await client.auth.resetPasswordForEmail(identifier.trim(), {
      redirectTo: new URL(import.meta.env.BASE_URL, window.location.href).toString(),
    });
    if (resetError) setError(resetError.message);
    else setResetSent(true);
    setBusy(false);
  }

  return (
    <main className="auth-page">
      <div className="auth-art">
        <div className="auth-art-pattern pattern-one" />
        <div className="auth-art-pattern pattern-two" />
        <span className="auth-doodle auth-doodle-one">✳</span>
        <span className="auth-doodle auth-doodle-two">✦</span>
        <div className="auth-art-copy">
          <span className="brand-mark brand-mark-light">m</span>
          <p>Weniger überlegen.<br />Mehr zusammen essen.</p>
          <span className="auth-caption">Euer Tisch, eure Woche.</span>
        </div>
        <div className="auth-food-art">🥘</div>
      </div>
      <section className="auth-form-wrap">
        <div className="auth-form">
          <span className="eyebrow">Willkommen bei Mampf</span>
          <h1>Schön, dass du<br />mit am Tisch sitzt.</h1>
          <p className="muted-copy">Melde dich an und plant eure Lieblingsgerichte gemeinsam.</p>
          <form onSubmit={signIn}>
            <label className="field-label">
              Nutzername oder E-Mail-Adresse
              <input
                type="text"
                autoComplete="username"
                required
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="Jan oder du@beispiel.de"
              />
            </label>
            <label className="field-label">
              Passwort
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Dein Passwort"
              />
            </label>
            <button type="button" className="inline-link reset-link" onClick={sendReset} disabled={busy}>
              Passwort vergessen?
            </button>
            {error && <p className="form-error" role="alert">{error}</p>}
            {resetSent && <p className="form-success" role="status">Der Link zum Zurücksetzen ist unterwegs.</p>}
            <button className="button button-primary auth-submit" disabled={busy}>
              {busy ? "Einen Moment …" : "Anmelden"} <ArrowRight size={17} />
            </button>
          </form>
          <div className="invite-note">
            <UsersRound size={17} />
            <span>Neue Konten werden über einen persönlichen Einrichtungs- oder Einladungslink erstellt.</span>
          </div>
        </div>
      </section>
    </main>
  );
}

function RegistrationScreen({
  invitationToken,
  ownerSetupToken,
  onRegister,
  busy,
}: {
  invitationToken: string | null;
  ownerSetupToken: string | null;
  onRegister: (values: { email: string; username: string; password: string }) => Promise<void>;
  busy: boolean;
}) {
  const isOwnerSetup = Boolean(ownerSetupToken);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState(isOwnerSetup ? "Jan" : "");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Dein Passwort sollte mindestens acht Zeichen lang sein.");
      return;
    }
    if (password !== repeatPassword) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }
    await onRegister({ email: email.trim(), username: isOwnerSetup ? "Jan" : username.trim(), password })
      .catch((reason: unknown) => setError(errorText(reason)));
  }

  return (
    <main className="setup-page">
      <div className="setup-mark">{isOwnerSetup ? "🍅" : "🥄"}</div>
      <p className="eyebrow">{isOwnerSetup ? "Der erste Platz am Tisch" : "Einladung angenommen"}</p>
      <h1>{isOwnerSetup ? "Willkommen, Jan." : "Mach es dir bequem."}</h1>
      <p>
        {isOwnerSetup
          ? "Trage deine E-Mail-Adresse ein und lege jetzt dein persönliches Passwort für den Hauptadmin-Zugang fest."
          : "Erstelle dein Konto, um Rezepte und Wochenpläne gemeinsam zu bearbeiten."}
      </p>
      <form className="setup-form" onSubmit={submit}>
        <label className="field-label">
          E-Mail-Adresse
          <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="field-label">
          Nutzername
          <input
            type="text"
            autoComplete="username"
            required
            minLength={3}
            maxLength={24}
            readOnly={isOwnerSetup}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label className="field-label">
          Passwort festlegen
          <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label className="field-label">
          Passwort wiederholen
          <input type="password" autoComplete="new-password" required value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary" disabled={busy}>
          {busy ? "Konto wird eingerichtet …" : isOwnerSetup ? "Hauptadmin-Konto erstellen" : "Konto erstellen"} <ArrowRight size={17} />
        </button>
      </form>
      {!invitationToken && !ownerSetupToken && <p className="form-error" role="alert">Dieser Registrierungslink ist unvollständig.</p>}
    </main>
  );
}

function HouseholdSetup({ onCreate, busy }: { onCreate: (name: string) => Promise<void>; busy: boolean }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    await onCreate(name.trim()).catch((reason: unknown) => setError(errorText(reason)));
  }

  return (
    <main className="setup-page">
      <div className="setup-mark">🍅</div>
      <p className="eyebrow">Der erste gemeinsame Schritt</p>
      <h1>Wie heißt euer Haushalt?</h1>
      <p>Gib eurem gemeinsamen Kochbuch einen Namen. Danach kannst du weitere Mitglieder einladen.</p>
      <form className="setup-form" onSubmit={submit}>
        <label className="field-label">
          Haushaltsname
          <input
            required
            maxLength={80}
            autoFocus
            placeholder="Zum Beispiel: Zuhause bei uns"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary" disabled={busy}>
          {busy ? "Wird eingerichtet …" : "Haushalt einrichten"} <ArrowRight size={17} />
        </button>
      </form>
    </main>
  );
}

function InvitationSetup({
  onComplete,
  onSignOut,
  busy,
  email,
  requiresPassword,
}: {
  onComplete: (password: string | null) => Promise<void>;
  onSignOut: () => void;
  busy: boolean;
  email: string;
  requiresPassword: boolean;
}) {
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (requiresPassword && password.length < 8) {
      setError("Dein Passwort sollte mindestens acht Zeichen lang sein.");
      return;
    }
    if (requiresPassword && password !== repeatPassword) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }
    await onComplete(requiresPassword ? password : null).catch((reason: unknown) => setError(errorText(reason)));
  }

  return (
    <main className="setup-page">
      <div className="setup-mark">🥄</div>
      <p className="eyebrow">Einladung angenommen</p>
      <h1>Mach es dir bequem.</h1>
      <p>
        {requiresPassword
          ? <>Lege ein Passwort für <strong>{email}</strong> fest und tritt eurem gemeinsamen Haushalt bei.</>
          : <>Bestätige die Einladung mit deinem Konto <strong>{email}</strong>.</>}
      </p>
      <form className="setup-form" onSubmit={submit}>
        {requiresPassword && (
          <>
            <label className="field-label">
              Neues Passwort
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="field-label">
              Passwort wiederholen
              <input
                type="password"
                autoComplete="new-password"
                required
                value={repeatPassword}
                onChange={(event) => setRepeatPassword(event.target.value)}
              />
            </label>
          </>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary" disabled={busy}>
          {busy ? "Wird eingerichtet …" : "Einladung annehmen"} <ArrowRight size={17} />
        </button>
        <button type="button" className="inline-link" onClick={onSignOut}>Mit einem anderen Konto anmelden</button>
      </form>
    </main>
  );
}

function PasswordResetSetup({
  onComplete,
  busy,
}: {
  onComplete: (password: string) => Promise<void>;
  busy: boolean;
}) {
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Dein Passwort sollte mindestens acht Zeichen lang sein.");
      return;
    }
    if (password !== repeatPassword) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }
    await onComplete(password).catch((reason: unknown) => setError(errorText(reason)));
  }

  return (
    <main className="setup-page">
      <div className="setup-mark">🔐</div>
      <p className="eyebrow">Neues Passwort</p>
      <h1>Wir machen die Tür wieder auf.</h1>
      <p>Wähle ein neues Passwort mit mindestens acht Zeichen.</p>
      <form className="setup-form" onSubmit={submit}>
        <label className="field-label">
          Neues Passwort
          <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label className="field-label">
          Passwort wiederholen
          <input type="password" autoComplete="new-password" required value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary" disabled={busy}>
          {busy ? "Wird gespeichert …" : "Neues Passwort speichern"} <ArrowRight size={17} />
        </button>
      </form>
    </main>
  );
}

function InviteDialog({
  onClose,
  onInvite,
  busy,
}: {
  onClose: () => void;
  onInvite: () => Promise<string>;
  busy: boolean;
}) {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function copyInvitationLink(inviteUrl: string) {
    if (!navigator.clipboard) {
      setError("Der Link kann hier nicht automatisch kopiert werden. Markiere ihn und kopiere ihn manuell.");
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    await onInvite().then(setInviteUrl).catch((reason: unknown) => setError(errorText(reason)));
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="invite-dialog modal-card" role="dialog" aria-modal="true" aria-labelledby="invite-title" onClick={(event) => event.stopPropagation()}>
        <button className="icon-button detail-close" onClick={onClose} aria-label="Schließen">×</button>
        <div className="invite-dialog-icon"><UsersRound size={22} /></div>
        {inviteUrl ? (
          <>
            <p className="eyebrow">Einladung zum Teilen</p>
            <h2>Der Einladungslink ist bereit.</h2>
            <p>Teile den persönlichen Link direkt mit deinem Haushaltsmitglied. Er ist sieben Tage gültig und kann nur einmal verwendet werden.</p>
            <div className="invite-link-box">
              <input aria-label="Persönlicher Einladungslink" readOnly value={inviteUrl} />
              <button
                type="button"
                className="button button-outline"
                onClick={() => void copyInvitationLink(inviteUrl)}
              >
                {copied ? "Kopiert" : "Link kopieren"}
              </button>
            </div>
            <button className="button button-primary" onClick={onClose}>Fertig</button>
          </>
        ) : (
          <>
            <p className="eyebrow">Gemeinsam schmeckt’s besser</p>
            <h2 id="invite-title">Jemanden einladen</h2>
            <p>Erstelle einen einmaligen Link und teile ihn direkt mit der Person. Sie legt beim Registrieren E-Mail, Nutzernamen und Passwort selbst fest.</p>
            <form onSubmit={submit}>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="button button-primary" disabled={busy}>
                {busy ? "Wird erstellt …" : "Einladungslink erstellen"} <ArrowRight size={17} />
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

function EmptyPlan({ onGenerate, hasRecipes, busy }: { onGenerate: () => void; hasRecipes: boolean; busy: boolean }) {
  return (
    <div className="empty-plan">
      <div className="empty-plan-icon">{hasRecipes ? "🥕" : "📖"}</div>
      <h3>{hasRecipes ? "Eure Woche ist noch offen." : "Erst ein paar Lieblingsrezepte sammeln."}</h3>
      <p>{hasRecipes ? "Lasst Mampf sieben Abende für euch planen." : "Wenn euer Kochbuch gefüllt ist, würfelt Mampf daraus euren Wochenplan."}</p>
      {hasRecipes && (
        <button className="button button-primary" onClick={onGenerate} disabled={busy}>
          <Sparkles size={16} /> {busy ? "Wird geplant …" : "Woche planen"}
        </button>
      )}
    </div>
  );
}

export default function App() {
  const client = supabase;
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(null);
  const [inviteRequiresPassword, setInviteRequiresPassword] = useState(false);
  const handledInviteTokens = useRef(new Set<string>());
  const [household, setHousehold] = useState<Household | null>(null);
  const [role, setRole] = useState<HouseholdRole>("member");
  const [memberCount, setMemberCount] = useState(0);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);
  const [archivedShoppingLists, setArchivedShoppingLists] = useState<ArchivedShoppingList[]>([]);
  const [newShoppingItem, setNewShoppingItem] = useState("");
  const [pantryItems, setPantryItems] = useState<PantryItem[]>([]);
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [view, setView] = useState<AppView>("home");
  const [busy, setBusy] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [darkMode, setDarkMode] = useState(readSavedDarkMode);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
  const suppressProfileFocusOpen = useRef(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editorRecipe, setEditorRecipe] = useState<Recipe | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [cookingRecipe, setCookingRecipe] = useState<Recipe | null>(null);
  const [recipeSearch, setRecipeSearch] = useState("");

  useEffect(() => {
    document.documentElement.dataset.theme = UI_THEME.id;
    document.documentElement.dataset.colorMode = darkMode ? "dark" : "light";
    if (!saveDarkMode(darkMode)) {
      setNotice("Der Darkmode gilt nur für diese Sitzung und konnte nicht gespeichert werden.");
    }
  }, [darkMode]);

  useEffect(() => {
    if (!profileMenuOpen) return;
    function closeProfileMenu(event: PointerEvent) {
      if (!(event.target instanceof Node) || !profileMenuRef.current?.contains(event.target)) setProfileMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeProfileMenu);
    return () => document.removeEventListener("pointerdown", closeProfileMenu);
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!client) return;
    let active = true;
    if (new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery") {
      setRecoveryMode(true);
    }
    client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: authListener } = client.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
      setAuthReady(true);
    });
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [client]);

  useEffect(() => {
    if (!client || !session) {
      setHousehold(null);
      setPantryItems([]);
      setArchivedShoppingLists([]);
      setWorkspaceReady(Boolean(session === null && authReady));
      setPendingInviteToken(null);
      setInviteRequiresPassword(false);
      return;
    }
    const activeSession = session;
    const supabaseClient = client;
    let active = true;
    setWorkspaceReady(false);
    setError("");
    async function loadMembership() {
      const urlParams = new URLSearchParams(window.location.search);
      const urlInviteToken = urlParams.get("invite") || urlParams.get("household_invite");
      const metadataToken = activeSession.user.user_metadata.household_invitation_token;
      const rawToken = urlInviteToken || (typeof metadataToken === "string" ? metadataToken : null);
      if (rawToken && !handledInviteTokens.current.has(rawToken)) {
        setPendingInviteToken(rawToken);
        const urlRequiresPassword = urlParams.get("set_password") === "true";
        setInviteRequiresPassword(urlRequiresPassword || (!urlInviteToken && Boolean(metadataToken)));
        setWorkspaceReady(true);
        return;
      }

      const { data, error: membershipError } = await supabaseClient
        .from("household_members")
        .select("household_id, role, households!inner(id, name)")
        .eq("user_id", activeSession.user.id)
        .maybeSingle();
      if (!active) return;
      if (membershipError) throw membershipError;
      if (!data) {
        setHousehold(null);
        setPantryItems([]);
        setWorkspaceReady(true);
        return;
      }
      const membership = data as unknown as {
        role: HouseholdRole;
        households: Household;
      };
      setRole(membership.role);
      setHousehold(membership.households);
      setWorkspaceReady(true);
    }
    loadMembership().catch((reason: unknown) => {
      if (!active) return;
      setError(errorText(reason));
      setWorkspaceReady(true);
    });
    return () => { active = false; };
  }, [client, session, workspaceRevision, authReady]);

  useEffect(() => {
    if (!client || !household) return;
    let active = true;
    setLoadingData(true);
    async function loadRecipes() {
      const { data, error: recipesError } = await client!
        .from("recipes")
        .select("id, household_id, title, description, category, source_url, image_url, prep_minutes, servings, emoji, created_at, recipe_ingredients(id, name, quantity, unit, sort_order), recipe_ratings(user_id, rating)")
        .eq("household_id", household!.id)
        .order("title");
      if (recipesError) throw recipesError;
      const recipeRows = (data ?? []) as unknown as Array<{
        id: string;
        household_id: string;
        title: string;
        description: string;
        category: string;
        source_url: string;
        image_url: string | null;
        prep_minutes: number | null;
        servings: number;
        emoji: string;
        created_at: string;
        recipe_ingredients: Recipe["recipe_ingredients"];
        recipe_ratings: Recipe["recipe_ratings"];
      }>;
      const cleanRecipes = recipeRows.map((value) => {
        return {
          ...value,
          recipe_ingredients: value.recipe_ingredients.slice().sort(
            (a, b) => a.sort_order - b.sort_order,
          ),
        };
      });
      if (active) setRecipes(cleanRecipes);
    }
    async function loadMembers() {
      const { data, error: membersError } = await client!
        .from("household_members")
        .select("user_id")
        .eq("household_id", household!.id);
      if (membersError) throw membersError;
      if (active) setMemberCount(data?.length ?? 0);
    }
    async function loadPantry() {
      try {
        const { data, error: pantryError } = await client!
          .from("pantry_items")
          .select("id, household_id, name, category, barcode, quantity, unit, image_path, created_at, updated_at")
          .eq("household_id", household!.id)
          .order("name");
        if (pantryError) throw pantryError;
        const rows = (data ?? []) as unknown as Array<Omit<PantryItem, "image_url">>;
        const items = await Promise.all(rows.map(async (item): Promise<PantryItem> => {
          if (!item.image_path) return { ...item, image_url: null };
          const { data: signedImage, error: imageError } = await client!
            .storage.from(PANTRY_IMAGE_BUCKET).createSignedUrl(item.image_path, 60 * 60);
          if (imageError) throw imageError;
          return { ...item, image_url: signedImage.signedUrl };
        }));
        if (active) setPantryItems(items);
      } catch (reason) {
        if (active) setError(pantryErrorMessage(reason));
      }
    }
    async function loadShoppingArchive() {
      const { data, error: archiveError } = await client!
        .from("meal_plans")
        .select("id, start_date, shopping_archived_at, shopping_items:shopping_list_items(id, plan_id, name, quantity, unit, checked, sort_order, is_custom)")
        .eq("household_id", household!.id)
        .not("shopping_archived_at", "is", null)
        .order("shopping_archived_at", { ascending: false })
        .limit(50);
      if (archiveError) throw archiveError;
      if (active) {
        setArchivedShoppingLists((data ?? []) as unknown as ArchivedShoppingList[]);
      }
    }
    Promise.all([loadRecipes(), loadMembers(), loadPantry(), loadShoppingArchive()])
      .catch((reason: unknown) => { if (active) setError(errorText(reason)); })
      .finally(() => { if (active) setLoadingData(false); });
    return () => { active = false; };
  }, [client, household, workspaceRevision]);

  useEffect(() => {
    if (!client || !household) return;
    let active = true;
    async function loadPlan() {
      const { data, error: planError } = await client!
        .from("meal_plans")
        .select("id, household_id, start_date, shopping_archived_at, plan_days:meal_plan_days(id, plan_id, day_date, excluded, recipe_id, recipe:recipes(id, title, description, prep_minutes, emoji)), shopping_items:shopping_list_items(id, plan_id, name, quantity, unit, checked, sort_order, is_custom)")
        .eq("household_id", household!.id)
        .eq("start_date", weekStart)
        .maybeSingle();
      if (planError) throw planError;
      if (!active) return;
      if (!data) {
        setPlan(null);
        setShoppingItems([]);
        return;
      }
      const result = data as unknown as MealPlan & { shopping_items: ShoppingItem[] };
      setPlan({
        ...result,
        plan_days: result.plan_days.slice().sort((a, b) => a.day_date.localeCompare(b.day_date)),
      });
      setShoppingItems(result.shopping_items.slice().sort((a, b) => a.sort_order - b.sort_order));
    }
    loadPlan()
      .catch((reason: unknown) => { if (active) setError(errorText(reason)); })
      .finally(() => { if (active) setLoadingData(false); });
    return () => { active = false; };
  }, [client, household, weekStart, workspaceRevision]);

  const recipesById = useMemo(() => new Map(recipes.map((recipe) => [recipe.id, recipe])), [recipes]);
  const todayKey = localDateKey(new Date());
  const todayPlanDay = plan?.plan_days.find((day) => day.day_date === todayKey);
  const todayRecipe = todayPlanDay?.recipe_id ? recipesById.get(todayPlanDay.recipe_id) ?? null : null;
  const visibleRecipes = useMemo(() => {
    const search = recipeSearch.trim().toLocaleLowerCase("de-DE");
    if (!search) return recipes;
    return recipes.filter((recipe) =>
      `${recipe.title} ${recipe.description} ${recipe.category}`.toLocaleLowerCase("de-DE").includes(search),
    );
  }, [recipes, recipeSearch]);
  const dayRows = useMemo(() => {
    const existing = new Map(plan?.plan_days.map((day) => [day.day_date, day]) ?? []);
    return weekDates(weekStart).map((day) => ({
      ...day,
      ...(existing.get(day.date) ?? {}),
      recipeId: existing.get(day.date)?.recipe_id ?? null,
      excluded: existing.get(day.date)?.excluded ?? false,
    }));
  }, [plan, weekStart]);

  async function loadRecentUsage(referenceWeek: string): Promise<RecipeUsage[]> {
    if (!client || !household) throw new Error("Haushalt nicht verfügbar.");
    const since = addDays(referenceWeek, -28);
    const { data, error: usageError } = await client
      .from("meal_plans")
      .select("start_date, plan_days:meal_plan_days(recipe_id, day_date)")
      .eq("household_id", household.id)
      .gte("start_date", since)
      .lt("start_date", referenceWeek);
    if (usageError) throw usageError;
    const usage: RecipeUsage[] = [];
    for (const mealPlan of (data ?? []) as Array<{ plan_days: Array<{ recipe_id: string | null; day_date: string }> }>) {
      for (const day of mealPlan.plan_days ?? []) {
        if (day.recipe_id && day.day_date >= since && day.day_date < referenceWeek) {
          usage.push({ recipeId: day.recipe_id, usedAt: `${day.day_date}T23:59:59` });
        }
      }
    }
    return usage;
  }

  async function persistPlan(days: Array<PlannedDay & { recipeId: string | null }>, message: string) {
    if (!client || !household || !session) throw new Error("Haushalt nicht verfügbar.");
    const payload = serializeMealPlan(days, recipesById);
    const { error: saveError } = await client.rpc("save_meal_plan", {
      plan_start_date: weekStart,
      ...payload,
    });
    if (saveError) throw saveError;
    setNotice(message);
    setError("");
    setWorkspaceRevision((revision) => revision + 1);
  }

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function generatePlan() {
    await runAction(async () => {
      if (!client || !household) throw new Error("Haushalt nicht verfügbar.");
      if (recipes.length === 0) throw new Error("Lege zuerst ein paar Rezepte an.");
      const usage = await loadRecentUsage(weekStart);
      const excludedDates = new Set(plan?.plan_days.filter((day) => day.excluded).map((day) => day.day_date));
      const candidates = recipes.map(({ id, title }) => ({ id, title }));
      const generated = chooseRecipesForWeek(
        candidates,
        weekDates(weekStart).map((day) => ({ ...day, excluded: excludedDates.has(day.date) })),
        usage,
      );
      await persistPlan(generated, "Euer Wochenplan und die Einkaufsliste sind bereit.");
    });
  }

  async function replaceMeal(dayDate: string) {
    await runAction(async () => {
      const currentDay = dayRows.find((day) => day.date === dayDate);
      const candidates = recipes.filter((recipe) => recipe.id !== currentDay?.recipeId);
      if (candidates.length === 0) throw new Error("Füge ein weiteres Rezept hinzu, um dieses Gericht zu ersetzen.");
      const usage = await loadRecentUsage(weekStart);
      const choice = chooseRecipesForWeek(
        candidates.map(({ id, title }) => ({ id, title })),
        [{ date: dayDate, excluded: false }],
        usage,
      )[0];
      await persistPlan(
        dayRows.map((day) => ({
          date: day.date,
          excluded: day.date === dayDate ? false : day.excluded,
          recipeId: day.date === dayDate ? choice.recipeId : day.recipeId,
        })),
        "Gericht ersetzt und Einkaufsliste aktualisiert.",
      );
    });
  }

  async function updatePlanDay(dayDate: string, patch: { excluded?: boolean; recipeId?: string | null }) {
    await runAction(async () => {
      const updated = dayRows.map((day) => ({
        date: day.date,
        excluded: day.date === dayDate ? (patch.excluded ?? false) : day.excluded,
        recipeId: day.date !== dayDate
          ? day.recipeId
          : patch.excluded
            ? null
            : patch.recipeId === undefined
              ? day.recipeId
              : patch.recipeId,
      }));
      await persistPlan(updated, "Wochenplan und Einkaufsliste wurden aktualisiert.");
    });
  }

  async function createRecipe(payload: RecipePayload) {
    setBusy(true);
    setError("");
    try {
      if (!client) throw new Error("Supabase ist nicht verbunden.");
      const sourceUrl = payload.source_url.trim();
      const { data: recipeId, error: saveError } = await client.rpc("save_recipe_with_category", {
        recipe_payload: { ...payload, steps: [] },
        target_recipe_id: editorRecipe?.id ?? null,
      });
      if (saveError) throw saveError;

      let imageUrl: string | null = null;
      let imageWarning = "";
      if (sourceUrl && typeof recipeId === "string") {
        const { data, error: imageError } = await client.functions.invoke<{ image_url: string | null }>(
          "resolve-recipe-image",
          { body: { recipe_id: recipeId } },
        );
        if (imageError) imageWarning = await functionErrorText(imageError);
        else imageUrl = data?.image_url ?? null;
      }

      setEditorOpen(false);
      setEditorRecipe(null);
      setWorkspaceRevision((revision) => revision + 1);
      const savedNotice = editorRecipe ? "Das Rezept wurde gemeinsam aktualisiert." : "Das Rezept ist in eurem Kochbuch.";
      setNotice(
        imageWarning
          ? `${savedNotice} Der Link ist gespeichert, aber das Titelbild konnte nicht ermittelt werden: ${imageWarning}`
          : sourceUrl && !imageUrl
            ? `${savedNotice} Zu diesem Link wurde kein Titelbild gefunden.`
            : savedNotice,
      );
      setSelectedRecipe(null);
    } catch (reason) {
      setError(errorText(reason));
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  async function deleteRecipe(recipe: Recipe) {
    if (!window.confirm(`"${recipe.title}" löschen? Geplante Tage werden freigegeben und die zugehörigen Einkaufslisten aktualisiert.`)) {
      return;
    }
    await runAction(async () => {
      if (!client || !household) throw new Error("Haushalt nicht verfügbar.");
      const { data, error: plansError } = await client
        .from("meal_plans")
        .select("start_date, plan_days:meal_plan_days(day_date, excluded, recipe_id)")
        .eq("household_id", household.id);
      if (plansError) throw plansError;
      const planRows = (data ?? []) as unknown as Array<{
        start_date: string;
        plan_days: Array<{ day_date: string; excluded: boolean; recipe_id: string | null }> | null;
      }>;
      const affectedPlans = planRows.filter((mealPlan) =>
        mealPlan.plan_days?.some((day) => day.recipe_id === recipe.id),
      );
      const remainingRecipes = new Map(
        recipes.filter((candidate) => candidate.id !== recipe.id).map((candidate) => [candidate.id, candidate]),
      );
      const plansPayload = affectedPlans.map((mealPlan) => {
        const days = weekDates(mealPlan.start_date).map((day) => {
          const existing = mealPlan.plan_days?.find((planDay) => planDay.day_date === day.date);
          return {
            ...day,
            excluded: existing?.excluded ?? false,
            recipeId: existing?.recipe_id === recipe.id ? null : existing?.recipe_id ?? null,
          };
        });
        return { start_date: mealPlan.start_date, ...serializeMealPlan(days, remainingRecipes) };
      });
      const { error: deleteError } = await client.rpc("delete_recipe_and_update_plans", {
        target_recipe_id: recipe.id,
        plans_payload: plansPayload,
      });
      if (deleteError) throw deleteError;
      setRecipes((current) => current.filter((candidate) => candidate.id !== recipe.id));
      setSelectedRecipe(null);
      setEditorOpen(false);
      setEditorRecipe(null);
      setWorkspaceRevision((revision) => revision + 1);
      setNotice("Das Gericht wurde gelöscht. Betroffene Wochenpläne und Einkaufslisten wurden aktualisiert.");
    });
  }

  async function savePantryItem(input: PantryItemSaveInput) {
    if (!client || !household) throw new Error("Haushalt nicht verfügbar.");
    setBusy(true);
    setError("");
    setNotice("");
    const existing = input.id ? pantryItems.find((item) => item.id === input.id) : undefined;
    let imagePath = input.removeImage ? null : existing?.image_path ?? null;
    let uploadedPath: string | null = null;
    try {
      if (input.imageFile) {
        const preparedImage = await preparePantryImage(input.imageFile);
        uploadedPath = `${household.id}/${crypto.randomUUID()}.${preparedImage.format.extension}`;
        const { error: uploadError } = await client.storage
          .from(PANTRY_IMAGE_BUCKET)
          .upload(uploadedPath, preparedImage.file, {
            cacheControl: "3600",
            contentType: preparedImage.format.contentType,
            upsert: false,
          });
        if (uploadError) {
          const code = "code" in uploadError && typeof uploadError.code === "string" ? uploadError.code : "";
          const detail = [uploadError.message, code && `(${code})`].filter(Boolean).join(" ");
          if (code === "42501" || /row-level security|permission denied/i.test(uploadError.message)) {
            throw new Error(`Supabase blockiert den Bild-Upload. Prüfe, ob der private Bucket „pantry-images“ und die Policy „pantry_images_member_access“ vorhanden sind. ${detail}`);
          }
          throw new Error(`Bild-Upload fehlgeschlagen: ${detail}`);
        }
        imagePath = uploadedPath;
      }

      const record = {
        household_id: household.id,
        name: input.name,
        category: input.category,
        barcode: input.barcode,
        quantity: input.quantity,
        unit: input.unit,
        image_path: imagePath,
      };
      if (input.addToExisting) {
        if (!input.id) throw new Error("Der vorhandene Vorratseintrag für den Barcode wurde nicht gefunden.");
        const { error: mergeError } = await client.rpc("add_pantry_stock", {
          p_item_id: input.id,
          p_quantity: input.quantity,
          p_name: input.name,
          p_category: input.category,
          p_barcode: input.barcode,
          p_unit: input.unit,
          p_image_path: imagePath,
        });
        if (mergeError) throw mergeError;
      } else if (input.id) {
        const { error: updateError } = await client
          .from("pantry_items")
          .update({ ...record, updated_at: new Date().toISOString() })
          .eq("id", input.id)
          .eq("household_id", household.id)
          .select("id")
          .single();
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await client
          .from("pantry_items")
          .insert(record)
          .select("id")
          .single();
        if (insertError) throw insertError;
      }
    } catch (reason) {
      if (uploadedPath) {
        let cleanupError: unknown;
        try {
          const result = await client.storage.from(PANTRY_IMAGE_BUCKET).remove([uploadedPath]);
          cleanupError = result.error;
        } catch (error) {
          cleanupError = error;
        }
        if (cleanupError) {
          const combinedError = new Error(`${pantryErrorMessage(reason)} Das nicht gespeicherte Bild konnte zudem nicht entfernt werden: ${errorText(cleanupError)}`);
          setError(errorText(combinedError));
          throw combinedError;
        }
      }
      setError(pantryErrorMessage(reason));
      throw reason;
    } finally {
      setBusy(false);
    }

    setWorkspaceRevision((revision) => revision + 1);
    setNotice(input.addToExisting
      ? "Die Menge wurde zum vorhandenen Vorrat addiert."
      : input.id ? "Der Vorrat wurde aktualisiert." : "Der Vorrat wurde hinzugefügt.");
    if (existing?.image_path && existing.image_path !== imagePath) {
      try {
        const { error: cleanupError } = await client.storage.from(PANTRY_IMAGE_BUCKET).remove([existing.image_path]);
        if (cleanupError) throw cleanupError;
      } catch (reason) {
        setError(`Der Vorrat wurde gespeichert, aber das alte Produktbild konnte nicht entfernt werden: ${errorText(reason)}`);
      }
    }
  }

  async function findPantryItemByBarcode(barcode: string): Promise<PantryItem | null> {
    if (!client || !household) throw new Error("Haushalt nicht verfügbar.");
    const { data, error: lookupError } = await client
      .from("pantry_items")
      .select("id, household_id, name, category, barcode, quantity, unit, image_path, created_at, updated_at")
      .eq("household_id", household.id)
      .eq("barcode", barcode)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!data) return null;

    const item = data as unknown as Omit<PantryItem, "image_url">;
    let imageUrl: string | null = null;
    if (item.image_path) {
      const { data: signedImage, error: imageError } = await client.storage
        .from(PANTRY_IMAGE_BUCKET)
        .createSignedUrl(item.image_path, 60 * 60);
      if (imageError) throw imageError;
      imageUrl = signedImage.signedUrl;
    }
    const result: PantryItem = { ...item, image_url: imageUrl };
    setPantryItems((current) => [
      ...current.filter((currentItem) => currentItem.id !== result.id),
      result,
    ]);
    return result;
  }

  async function deletePantryItem(item: PantryItem) {
    if (!client || !household) throw new Error("Haushalt nicht verfügbar.");
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { error: deleteError } = await client
        .from("pantry_items")
        .delete()
        .eq("id", item.id)
        .eq("household_id", household.id)
        .select("id")
        .single();
      if (deleteError) throw deleteError;
    } catch (reason) {
      setError(pantryErrorMessage(reason));
      throw reason;
    } finally {
      setBusy(false);
    }
    setWorkspaceRevision((revision) => revision + 1);
    setNotice("Der Vorrat wurde entfernt.");
    if (item.image_path) {
      try {
        const { error: cleanupError } = await client.storage.from(PANTRY_IMAGE_BUCKET).remove([item.image_path]);
        if (cleanupError) throw cleanupError;
      } catch (reason) {
        setError(`Der Vorrat wurde entfernt, aber das Produktbild konnte nicht gelöscht werden: ${errorText(reason)}`);
      }
    }
  }

  async function rateRecipe(recipeId: string, rating: number) {
    await runAction(async () => {
      if (!client || !session) throw new Error("Du musst angemeldet sein, um ein Rezept zu bewerten.");
      const { error: ratingError } = await client.from("recipe_ratings").upsert(
        { recipe_id: recipeId, user_id: session.user.id, rating },
        { onConflict: "recipe_id,user_id" },
      );
      if (ratingError) throw ratingError;

      const updateRating = (recipe: Recipe): Recipe => recipe.id === recipeId
        ? {
          ...recipe,
          recipe_ratings: [
            ...recipe.recipe_ratings.filter((entry) => entry.user_id !== session.user.id),
            { user_id: session.user.id, rating },
          ],
        }
        : recipe;
      setRecipes((current) => current.map(updateRating));
      setSelectedRecipe((current) => current ? updateRating(current) : current);
      setNotice("Deine Bewertung wurde gespeichert.");
    });
  }

  async function inviteMember(): Promise<string> {
    if (!client || !household) throw new Error("Haushalt nicht verfügbar.");
    const { data, error: inviteError } = await client.functions.invoke("invite-household-member", {
      body: { household_id: household.id },
    });
    if (inviteError) {
      throw new Error(await functionErrorText(inviteError));
    }
    if (data?.error) throw new Error(data.error);
    if (typeof data?.invite_url === "string") return data.invite_url;
    throw new Error("Die Einladung wurde nicht bestätigt. Bitte versuche es noch einmal.");
  }

  async function registerAccount(values: { email: string; username: string; password: string }) {
    if (!client) throw new Error("Supabase ist nicht verbunden.");
    const url = new URL(window.location.href);
    const invitationToken = url.searchParams.get("invite");
    const ownerSetupToken = url.searchParams.get("owner_setup");
    if (Boolean(invitationToken) === Boolean(ownerSetupToken)) {
      throw new Error("Dieser Registrierungslink ist ungültig oder unvollständig.");
    }

    setBusy(true);
    try {
      const { data, error: registrationError } = await client.functions.invoke<{
        registered?: boolean;
        session?: Pick<Session, "access_token" | "refresh_token">;
      }>("complete-household-registration", {
        body: {
          ...(ownerSetupToken ? { owner_setup_token: ownerSetupToken } : { invitation_token: invitationToken }),
          email: values.email,
          username: values.username,
          password: values.password,
        },
      });
      if (registrationError) throw new Error(await functionErrorText(registrationError));
      if (data?.session) {
        const { error: sessionError } = await client.auth.setSession(data.session);
        if (sessionError) throw sessionError;
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.delete("owner_setup");
        currentUrl.searchParams.delete("invite");
        currentUrl.searchParams.delete("household_invite");
        window.history.replaceState(null, "", currentUrl);
        return;
      }
      if (data?.registered) {
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.delete("owner_setup");
        currentUrl.searchParams.delete("invite");
        window.history.replaceState(null, "", currentUrl);
        throw new Error("Dein Konto wurde erstellt. Bitte melde dich mit deinem Nutzernamen und Passwort an.");
      }
      throw new Error("Das Konto konnte nicht eingerichtet werden.");
    } finally {
      setBusy(false);
    }
  }

  async function acceptInvitation(password: string | null) {
    if (!client || !pendingInviteToken) throw new Error("Einladung nicht verfügbar.");
    setBusy(true);
    try {
      if (password) {
        const { error: passwordError } = await client.auth.updateUser({ password });
        if (passwordError) throw passwordError;
      }
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pendingInviteToken));
      const inviteTokenHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const { error: acceptError } = await client.rpc("accept_household_invite", {
        invite_token_hash: inviteTokenHash,
      });
      if (acceptError) throw acceptError;
      handledInviteTokens.current.add(pendingInviteToken);
      setPendingInviteToken(null);
      setInviteRequiresPassword(false);
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.delete("invite");
      currentUrl.searchParams.delete("household_invite");
      currentUrl.searchParams.delete("set_password");
      window.history.replaceState(null, "", currentUrl);
      setWorkspaceRevision((revision) => revision + 1);
      setNotice("Willkommen im gemeinsamen Haushalt.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleShoppingItem(item: ShoppingItem) {
    if (!client) return;
    const { error: updateError } = await client
      .from("shopping_list_items")
      .update({ checked: !item.checked })
      .eq("id", item.id);
    if (updateError) {
      setError(errorText(updateError));
      return;
    }
    const updatedItems = shoppingItems.map((entry) => entry.id === item.id
      ? { ...entry, checked: !item.checked }
      : entry);
    setShoppingItems(updatedItems);
    if (plan?.id !== item.plan_id) return;

    const allCompleted = isShoppingListComplete(updatedItems);
    const archivedAt = allCompleted ? plan.shopping_archived_at ?? new Date().toISOString() : null;
    setPlan({ ...plan, shopping_archived_at: archivedAt });
    setArchivedShoppingLists((current) => {
      const remaining = current.filter((entry) => entry.id !== plan.id);
      return archivedAt
        ? [{ ...plan, shopping_archived_at: archivedAt, shopping_items: updatedItems }, ...remaining]
        : remaining;
    });
  }

  async function addManualShoppingItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newShoppingItem.trim();
    if (!name) return;
    await runAction(async () => {
      if (!client || !household || !session) throw new Error("Haushalt nicht verfügbar.");
      let planId = plan?.id;
      if (!planId) {
        const { data, error: planError } = await client
          .from("meal_plans")
          .upsert(
            { household_id: household.id, start_date: weekStart, created_by: session.user.id },
            { onConflict: "household_id,start_date" },
          )
          .select("id")
          .single();
        if (planError) throw planError;
        planId = data.id;
      }
      const sortOrder = Math.max(-1, ...shoppingItems.map((item) => item.sort_order)) + 1;
      const { error: insertError } = await client.from("shopping_list_items").insert({
        plan_id: planId,
        name,
        quantity: null,
        unit: "",
        checked: false,
        sort_order: sortOrder,
        is_custom: true,
      });
      if (insertError) throw insertError;
      setNewShoppingItem("");
      setWorkspaceRevision((revision) => revision + 1);
      setNotice("Der eigene Eintrag wurde zur Einkaufsliste hinzugefügt.");
    });
  }

  async function restoreShoppingList(archived: ArchivedShoppingList) {
    await runAction(async () => {
      if (!client || !household) throw new Error("Haushalt nicht verfügbar.");
      const { error: restoreError } = await client
        .from("meal_plans")
        .update({ shopping_archived_at: null })
        .eq("id", archived.id)
        .eq("household_id", household.id)
        .select("id")
        .single();
      if (restoreError) throw restoreError;
      setWeekStart(archived.start_date);
      setWorkspaceRevision((revision) => revision + 1);
      setNotice("Die Einkaufsliste wurde wiederhergestellt. Der Abhakstatus bleibt erhalten.");
    });
  }

  if (!isSupabaseConfigured || !client) {
    return (
      <main className="config-screen">
        <div className="config-card">
          <span className="brand-mark">m</span>
          <p className="eyebrow">Fast fertig gedeckt</p>
          <h1>Mampf braucht noch eure Supabase-Verbindung.</h1>
          <p>Lege eine lokale <code>.env</code>-Datei auf Basis von <code>.env.example</code> an und trage die Supabase-URL sowie den Publishable Key ein.</p>
          <p className="config-variable">NEXT_PUBLIC_SUPABASE_URL</p>
          <p className="config-variable">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</p>
        </div>
      </main>
    );
  }

  if (!authReady) {
    return <main className="loading-screen"><span className="brand-mark">m</span><p>Einen Moment, der Tisch wird gedeckt …</p></main>;
  }
  if (recoveryMode && session) {
    return (
      <PasswordResetSetup
        busy={busy}
        onComplete={(password) => {
          setBusy(true);
          return client.auth.updateUser({ password }).then(({ error: updateError }) => {
            if (updateError) throw updateError;
            setRecoveryMode(false);
            setNotice("Dein Passwort wurde aktualisiert.");
          }).finally(() => setBusy(false));
        }}
      />
    );
  }
  const registrationParams = new URLSearchParams(window.location.search);
  const invitationToken = registrationParams.get("invite");
  const ownerSetupToken = registrationParams.get("owner_setup");
  if (!session && (invitationToken || ownerSetupToken)) {
    return (
      <RegistrationScreen
        invitationToken={invitationToken}
        ownerSetupToken={ownerSetupToken}
        onRegister={registerAccount}
        busy={busy}
      />
    );
  }
  if (!session) return <AuthScreen client={client} />;
  if (pendingInviteToken) {
    return (
      <InvitationSetup
        email={session.user.email ?? "deine E-Mail-Adresse"}
        busy={busy}
        requiresPassword={inviteRequiresPassword}
        onComplete={acceptInvitation}
        onSignOut={() => void runAction(async () => {
          const { error: signOutError } = await client.auth.signOut();
          if (signOutError) throw signOutError;
        })}
      />
    );
  }
  if (!workspaceReady) {
    return <main className="loading-screen"><span className="brand-mark">m</span><p>Euer Haushalt wird geöffnet …</p></main>;
  }
  if (!household) {
    return (
      <>
        {error && <div className="floating-error">{error}</div>}
        <HouseholdSetup
          busy={busy}
          onCreate={(name) => runAction(async () => {
            const { error: createError } = await client.rpc("create_household", { household_name: name });
            if (createError) throw createError;
            setWorkspaceRevision((revision) => revision + 1);
          })}
        />
      </>
    );
  }

  const navItems: Array<{ id: AppView; icon: typeof Home }> = [
    { id: "home", icon: Home },
    { id: "plan", icon: CalendarDays },
    { id: "recipes", icon: Utensils },
    { id: "shopping", icon: ShoppingBasket },
    { id: "pantry", icon: Package },
  ];
  const todayLabel = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const completedItems = shoppingItems.filter((item) => item.checked).length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand-lockup" onClick={() => setView("home")} aria-label="Mampf Startseite">
          <span className="brand-mark">m</span>
          <span className="brand-name">mampf<span>.</span></span>
        </button>
        <nav className="top-nav" aria-label="Hauptnavigation">
          {navItems.map(({ id, icon: Icon }) => (
            <button key={id} className={view === id ? "nav-link active" : "nav-link"} aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}>
              <Icon size={17} /> {viewLabels[id]}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <div className="household-chip"><UsersRound size={15} /><span>{household.name}</span></div>
          {role === "owner" && (
            <button className="button button-outline invite-button" onClick={() => setInviteOpen(true)}>
              <Plus size={16} /> <span>Einladen</span>
            </button>
          )}
          <div
            ref={profileMenuRef}
            className={`profile-menu${profileMenuOpen ? " is-open" : ""}`}
            onMouseEnter={() => setProfileMenuOpen(true)}
            onMouseLeave={() => setProfileMenuOpen(false)}
            onFocus={() => {
              if (suppressProfileFocusOpen.current) {
                suppressProfileFocusOpen.current = false;
                return;
              }
              setProfileMenuOpen(true);
            }}
            onBlur={(event) => {
              if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setProfileMenuOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setProfileMenuOpen(false);
                suppressProfileFocusOpen.current = true;
                profileTriggerRef.current?.focus();
              }
            }}
          >
            <button
              ref={profileTriggerRef}
              type="button"
              className="profile-menu-trigger"
              aria-label="Profil und Designvorlagen"
              aria-expanded={profileMenuOpen}
              aria-controls="profile-flyout"
              onClick={() => setProfileMenuOpen(true)}
            >
              <span className="avatar">{localName(session.user.email, session.user.user_metadata.username)[0]?.toLocaleUpperCase("de-DE") ?? "M"}</span>
              <span className="profile-name">{localName(session.user.email, session.user.user_metadata.username)}</span>
              <ChevronDown className="profile-menu-chevron" size={15} />
            </button>
            <div className="profile-flyout" id="profile-flyout" aria-label="Design und Konto">
              <div className="profile-flyout-user">
                <strong>{localName(session.user.email, session.user.user_metadata.username)}</strong>
                <small>{session.user.email}</small>
              </div>
              <div className="theme-picker-heading">
                <span><Palette size={16} /> Oberfläche</span>
                <small>Design</small>
              </div>
              <div className="theme-picker" aria-label="Aktives Design">
                <div className="theme-option selected">
                  <span className="theme-swatch theme-swatch--ocean" aria-hidden="true" />
                  <span className="theme-option-copy">
                    <strong>{UI_THEME.name}</strong>
                    <small>{UI_THEME.style}</small>
                  </span>
                  <Check className="theme-selected-check" size={16} aria-hidden="true" />
                </div>
              </div>
              <button
                type="button"
                className="dark-mode-toggle"
                aria-pressed={darkMode}
                onClick={() => setDarkMode((enabled) => !enabled)}
              >
                {darkMode ? <Sun size={18} /> : <Moon size={18} />}
                <span>{darkMode ? "Helles Design" : "Darkmode"}</span>
                <span className={`dark-mode-switch${darkMode ? " is-on" : ""}`} aria-hidden="true"><i /></span>
              </button>
              <button
                type="button"
                className="profile-logout"
                onClick={() => void runAction(async () => {
                  const { error: signOutError } = await client.auth.signOut();
                  if (signOutError) throw signOutError;
                })}
              >
                <LogOut size={17} /> Abmelden
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="page-content">
        {error && <div className="status-banner error-banner" role="alert"><CircleHelp size={17} /> {error}<button onClick={() => setError("")}>Schließen</button></div>}
        {notice && <div className="status-banner success-banner" role="status"><Check size={17} /> {notice}<button onClick={() => setNotice("")}>Schließen</button></div>}
        {loadingData && <div className="loading-line"><span /> Daten werden aktualisiert …</div>}

        {view === "home" && (
          <div className="home-page">
            <section className="greeting-row">
              <div>
                <p className="eyebrow">{todayLabel}</p>
                <h1>Was gibt’s heute, {localName(session.user.email, session.user.user_metadata.username)}?</h1>
              </div>
              <button className="button button-quiet greeting-plan-button" onClick={() => setView("plan")}>
                Zur Wochenübersicht <ArrowRight size={17} />
              </button>
            </section>
            <section className={todayRecipe ? "today-card" : "today-card today-card-empty"}>
              <div className="today-copy">
                <span className="today-overline"><span className="today-dot" /> HEUTE AUF DEM TISCH</span>
                {todayRecipe ? (
                  <>
                    <h2>{todayRecipe.title}</h2>
                    <p>{todayRecipe.description || "Ein leckeres Abendessen aus eurem Kochbuch."}</p>
                    <div className="today-meta">
                      {todayRecipe.prep_minutes && <span><Clock3 size={15} /> {todayRecipe.prep_minutes} Min.</span>}
                      <span><UsersRound size={15} /> Für 4 Portionen</span>
                    </div>
                    <button className="button button-light" onClick={() => setSelectedRecipe(todayRecipe)}>
                      Rezept ansehen <ArrowRight size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <h2>Ein Abend ganz ohne Plan?</h2>
                    <p>{todayPlanDay?.excluded ? "Heute habt ihr euch einen planfreien Abend gelassen." : "Wählt ein Gericht aus eurem Kochbuch oder plant die Woche gemeinsam."}</p>
                    <button className="button button-light" onClick={() => setView("plan")}>
                      {todayPlanDay?.excluded ? "Wochenplan ansehen" : "Gericht eintragen"} <ArrowRight size={16} />
                    </button>
                  </>
                )}
              </div>
              <div className="today-illustration">
                <div className="illustration-sun" />
                <div className="illustration-scribble">✳</div>
                <RecipeArtwork className="today-food" imageUrl={todayRecipe?.image_url} emoji={todayRecipe?.emoji ?? "🍲"} />
              </div>
              <div className="today-card-decoration">M</div>
            </section>

            <div className="home-grid">
              <section className="panel weekly-panel">
                <div className="panel-heading">
                  <div><p className="eyebrow">Eure nächsten Abende</p><h2>Die Woche im Blick</h2></div>
                  <button className="icon-text-button" onClick={() => setView("plan")}>Alle Tage <ArrowRight size={16} /></button>
                </div>
                {plan ? (
                  <div className="week-tiles">
                    {dayRows.map((day, index) => {
                      const recipe = day.recipeId ? recipesById.get(day.recipeId) : undefined;
                      const isToday = day.date === todayKey;
                      return (
                        <button
                          key={day.date}
                          className={`week-tile${isToday ? " is-today" : ""}${day.excluded ? " is-excluded" : ""}`}
                          onClick={() => recipe && setSelectedRecipe(recipe)}
                        >
                          <span className="week-tile-day">{formatDateKey(day.date, { weekday: "short" }).replace(".", "")}</span>
                          <span className="week-tile-date">{formatDateKey(day.date, { day: "numeric" })}</span>
                          <RecipeArtwork
                            className="week-tile-art"
                            imageUrl={day.excluded ? null : recipe?.image_url}
                            emoji={day.excluded ? "☕" : recipe?.emoji ?? "＋"}
                          />
                          <span className="week-tile-name">{day.excluded ? "frei" : recipe?.title ?? "offen"}</span>
                          <span className="week-tile-marker">{isToday ? "heute" : `0${index + 1}`}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyPlan onGenerate={generatePlan} hasRecipes={recipes.length > 0} busy={busy} />
                )}
              </section>
              <section className="panel shopping-preview">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Alles auf einen Blick</p>
                    <h2>Einkaufsliste <span className="count-badge">{shoppingItems.length}</span></h2>
                  </div>
                  <button className="round-arrow" aria-label="Einkaufsliste öffnen" onClick={() => setView("shopping")}><ArrowDownRight size={18} /></button>
                </div>
                {shoppingItems.length > 0 ? (
                  <>
                    <div className="shopping-progress"><span style={{ width: `${(completedItems / shoppingItems.length) * 100}%` }} /></div>
                    <div className="shopping-progress-caption"><span>{completedItems} von {shoppingItems.length} erledigt</span><ShoppingBasket size={15} /></div>
                    <ul className="shopping-preview-list">
                      {shoppingItems.slice(0, 5).map((item) => {
                        const summary = pantrySummary(item, pantryItems);
                        return (
                          <li key={item.id} className={item.checked ? "checked" : ""}>
                            <button aria-label={`${item.checked ? "Abhaken rückgängig" : "Abhaken"}: ${item.name}`} onClick={() => void toggleShoppingItem(item)}>
                              {item.checked && <Check size={12} />}
                            </button>
                            <span className="shopping-preview-copy">
                              <span>{item.name}</span>
                              {summary && <small className="pantry-stock-note">{summary}</small>}
                            </span>
                            <small>{formatQuantity(item.quantity, item.unit)}</small>
                          </li>
                        );
                      })}
                    </ul>
                    <button className="text-button shopping-open-link" onClick={() => setView("shopping")}>Liste öffnen <ArrowRight size={15} /></button>
                  </>
                ) : (
                  <div className="shopping-empty"><span>🧺</span><p>Mit eurem Wochenplan füllt sich hier der Einkaufskorb.</p></div>
                )}
              </section>
            </div>
          </div>
        )}

        {view === "plan" && (
          <div className="section-page">
            <div className="page-title-row">
              <div>
                <p className="eyebrow">Mit gutem Geschmack geplant</p>
                <h1>Euer Wochenplan</h1>
                <p>Sieben Abende, viele gute Ideen und ein bisschen weniger Alltagsstress.</p>
              </div>
              <div className="page-actions">
                <div className="week-switcher">
                  <button className="icon-button" aria-label="Vorherige Woche" onClick={() => setWeekStart((date) => addDays(date, -7))}><ChevronLeft size={18} /></button>
                  <span>{formatDateKey(weekStart, { day: "numeric", month: "short" })} – {formatDateKey(addDays(weekStart, 6), { day: "numeric", month: "short", year: "numeric" })}</span>
                  <button className="icon-button" aria-label="Nächste Woche" onClick={() => setWeekStart((date) => addDays(date, 7))}><ChevronRight size={18} /></button>
                </div>
                <button className="button button-primary" onClick={generatePlan} disabled={busy || recipes.length === 0}>
                  <Sparkles size={16} /> {plan ? "Neu würfeln" : "Woche planen"}
                </button>
              </div>
            </div>
            {recipes.length === 0 ? (
              <EmptyPlan onGenerate={generatePlan} hasRecipes={false} busy={busy} />
            ) : (
              <div className="plan-layout">
                <section className="plan-days">
                  {dayRows.map((day) => {
                    const recipe = day.recipeId ? recipesById.get(day.recipeId) : undefined;
                    return (
                      <article key={day.date} className={`plan-day-card${day.excluded ? " day-free" : ""}`}>
                        <div className="plan-day-date">
                          <span>{formatDateKey(day.date, { weekday: "short" }).replace(".", "")}</span>
                          <strong>{formatDateKey(day.date, { day: "2-digit" })}</strong>
                          <small>{formatDateKey(day.date, { month: "short" }).replace(".", "")}</small>
                        </div>
                        <div className="plan-day-main">
                          {day.excluded ? (
                            <div className="day-off-copy"><strong>Ein freier Abend</strong><span>Heute bleibt die Küche vielleicht kalt.</span></div>
                          ) : (
                            <button className="plan-meal" onClick={() => recipe && setSelectedRecipe(recipe)}>
                              <RecipeArtwork className="plan-meal-art" imageUrl={recipe?.image_url} emoji={recipe?.emoji ?? "＋"} />
                              <span><strong>{recipe?.title ?? "Gericht wählen"}</strong><small>{recipe?.description || "Aus eurem Kochbuch"}</small></span>
                            </button>
                          )}
                        </div>
                        <div className="plan-day-controls">
                          {!day.excluded && (
                            <>
                              <label className="recipe-select-wrap">
                                <span className="visually-hidden">Gericht auswählen</span>
                                <select
                                  value={day.recipeId ?? ""}
                                  onChange={(event) => void updatePlanDay(day.date, { recipeId: event.target.value || null })}
                                >
                                  <option value="">Gericht wählen …</option>
                                  {recipes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                                </select>
                                <ChevronDown size={14} />
                              </label>
                              <button className="icon-button" aria-label="Gericht ersetzen" title="Anderes Gericht vorschlagen" onClick={() => void replaceMeal(day.date)} disabled={busy || recipes.length < 2}>
                                <Settings2 size={17} />
                              </button>
                            </>
                          )}
                          <label className="exclude-toggle">
                            <input
                              type="checkbox"
                              checked={day.excluded}
                              onChange={(event) => void updatePlanDay(day.date, { excluded: event.target.checked })}
                            />
                            <span>{day.excluded ? "frei" : "Tag frei lassen"}</span>
                          </label>
                        </div>
                      </article>
                    );
                  })}
                </section>
                <aside className="plan-sidebar">
                  <div className="plan-note-card">
                    <div className="note-illustration">🥣</div>
                    <p className="eyebrow">Ein kleiner Tipp</p>
                    <h3>Abwechslung kommt von allein.</h3>
                    <p>Gerichte der letzten vier Wochen werden bei der Zufallsauswahl möglichst übersprungen.</p>
                  </div>
                  <div className="plan-list-card">
                    <div className="plan-list-heading"><ShoppingBasket size={18} /><div><strong>Dein Einkauf</strong><span>{shoppingItems.length} Zutaten</span></div></div>
                    <div className="mini-list-art">{shoppingItems.length > 0 ? "🥕 🧅 🫑" : "🧺"}</div>
                    <button className="button button-outline full-width" onClick={() => setView("shopping")}>Zur Einkaufsliste <ArrowRight size={15} /></button>
                  </div>
                </aside>
              </div>
            )}
          </div>
        )}

        {view === "recipes" && (
          <div className="section-page">
            <div className="page-title-row">
              <div><p className="eyebrow">Eure guten Ideen</p><h1>Das gemeinsame Kochbuch</h1><p>Lieblingsgerichte, die alle am Tisch glücklich machen.</p></div>
              <button className="button button-primary" onClick={() => { setEditorRecipe(null); setEditorOpen(true); }}><Plus size={17} /> Rezept hinzufügen</button>
            </div>
            <div className="recipe-toolbar">
              <label className="search-field"><Search size={17} /><input placeholder="Rezepte durchsuchen" value={recipeSearch} onChange={(event) => setRecipeSearch(event.target.value)} /></label>
              <div className="recipe-count">{recipes.length} {recipes.length === 1 ? "Lieblingsrezept" : "Lieblingsrezepte"}</div>
            </div>
            {visibleRecipes.length > 0 ? (
              <div className="recipe-grid">
                {visibleRecipes.map((recipe, index) => (
                  <article className={`recipe-card recipe-tone-${index % 4}`} key={recipe.id}>
                    <button className="recipe-card-open" onClick={() => setSelectedRecipe(recipe)} aria-label={`${recipe.title} ansehen`}>
                      <RecipeArtwork className="recipe-card-art" imageUrl={recipe.image_url} emoji={recipe.emoji}>
                        <i>{["✳", "✦", "·", "✻"][index % 4]}</i>
                        <small>{recipe.prep_minutes ? `${recipe.prep_minutes} MIN` : "MIT LIEBE"}</small>
                      </RecipeArtwork>
                      <div className="recipe-card-copy">
                        <div>
                          <h2>{recipe.title}</h2>
                          <p>{recipe.description || "Ein neues Lieblingsgericht für euren Tisch."}</p>
                          {(recipe.category || recipe.recipe_ratings.length > 0) && (
                            <div className="recipe-card-meta">
                              {recipe.category && <span className="category-chip">{recipe.category}</span>}
                              {recipe.recipe_ratings.length > 0 && (
                                <span className="card-rating">
                                  ★ {averageRating(recipe.recipe_ratings)?.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <span className="recipe-card-arrow"><ArrowRight size={17} /></span>
                      </div>
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-recipes">
                <span>{recipeSearch ? "🔎" : "📖"}</span>
                <h2>{recipeSearch ? "Kein Rezept gefunden." : "Das Kochbuch ist noch leer."}</h2>
                <p>{recipeSearch ? "Versuche einen anderen Suchbegriff." : "Fangt mit euren Lieblingsrezepten an und lasst Mampf daraus eure Wochen planen."}</p>
                {!recipeSearch && <button className="button button-primary" onClick={() => { setEditorRecipe(null); setEditorOpen(true); }}><Plus size={16} /> Erstes Rezept hinzufügen</button>}
              </div>
            )}
          </div>
        )}

        {view === "shopping" && (
          <div className="section-page shopping-page">
            <div className="page-title-row">
              <div><p className="eyebrow">Gut vorbereitet einkaufen</p><h1>Der Einkaufszettel</h1><p>Alles, was ihr für die geplanten Gerichte braucht.</p></div>
              <div className="shopping-total">{completedItems}<span> / {shoppingItems.length} erledigt</span></div>
            </div>
            <form className="shopping-add-form" onSubmit={(event) => void addManualShoppingItem(event)}>
              <label className="field-label">
                Eigener Eintrag
                <input
                  value={newShoppingItem}
                  onChange={(event) => setNewShoppingItem(event.target.value)}
                  maxLength={120}
                  placeholder="z. B. Kaffee oder Spülmittel"
                  required
                />
              </label>
              <button className="button button-primary" type="submit" disabled={busy || !newShoppingItem.trim()}>
                <Plus size={16} /> Hinzufügen
              </button>
            </form>
            {shoppingItems.length > 0 ? (
              plan?.shopping_archived_at ? (
                <section className="shopping-archived-banner">
                  <Archive size={22} />
                  <div><h2>Diese Einkaufsliste ist abgeschlossen.</h2><p>Sie wurde automatisch archiviert und bleibt unten im Archiv verfügbar.</p></div>
                </section>
              ) : (
                <div className="shopping-layout">
                  <section className="shopping-list-card">
                    <div className="shopping-list-card-head"><div><span className="shopping-bag-icon">🛍️</span><div><h2>Diese Woche</h2><p>{formatDateKey(weekStart, { day: "numeric", month: "long" })} – {formatDateKey(addDays(weekStart, 6), { day: "numeric", month: "long" })}</p></div></div><span className="shopping-counter">{shoppingItems.length - completedItems} offen</span></div>
                    <div className="shopping-big-progress"><span style={{ width: `${(completedItems / shoppingItems.length) * 100}%` }} /></div>
                    <ul className="shopping-full-list">
                      {shoppingItems.map((item) => {
                        const summary = pantrySummary(item, pantryItems);
                        return (
                          <li key={item.id} className={item.checked ? "checked" : ""}>
                            <button className="shopping-checkbox" onClick={() => void toggleShoppingItem(item)} aria-label={`${item.checked ? "Wieder öffnen" : "Als erledigt markieren"}: ${item.name}`}>
                              {item.checked && <Check size={14} />}
                            </button>
                            <span className="shopping-item-copy">
                              <span className="shopping-item-name">{item.name}</span>
                              {item.is_custom && <small>Eigener Eintrag</small>}
                              {summary && <small className="pantry-stock-note">{summary}</small>}
                            </span>
                            <span className="shopping-item-amount">{formatQuantity(item.quantity, item.unit)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                  <aside className="shopping-side">
                    <div className="shopping-illustration-card"><div className="market-bag">🧺</div><span>frisch geplant</span><i>✳</i></div>
                    <div className="shopping-hint"><Sparkles size={18} /><p>Doppelte Zutaten sind zusammengerechnet. Mampf zeigt Vorrat und Restbedarf; Bestände werden nicht automatisch verändert.</p></div>
                    <button className="button button-outline full-width" onClick={() => setView("pantry")}><Package size={16} /> Vorräte verwalten</button>
                    <button className="button button-outline full-width" onClick={() => setView("plan")}><CalendarDays size={16} /> Zum Wochenplan</button>
                  </aside>
                </div>
              )
            ) : (
              <div className="empty-recipes shopping-empty-page">
                <span>🧺</span><h2>Der Einkaufskorb wartet.</h2>
                <p>Fügt einen eigenen Eintrag hinzu oder erstellt einen Wochenplan für automatisch zusammengestellte Zutaten.</p>
                <button className="button button-primary" onClick={() => setView("plan")}>Wochenplan ansehen <ArrowRight size={16} /></button>
              </div>
            )}
            {archivedShoppingLists.length > 0 && (
              <section className="shopping-archive">
                <h2><Archive size={20} /> Archiv</h2>
                {archivedShoppingLists.map((archived) => (
                  <details className="shopping-archive-entry" key={archived.id}>
                    <summary>
                      <span>{formatDateKey(archived.start_date, { day: "numeric", month: "long" })} – {formatDateKey(addDays(archived.start_date, 6), { day: "numeric", month: "long", year: "numeric" })}</span>
                      <small>{archived.shopping_items.length} Einträge</small>
                    </summary>
                    <ul className="shopping-archive-items">
                      {archived.shopping_items.map((item) => (
                        <li key={item.id}><Check size={14} /><span>{item.name}{item.is_custom && <small>Eigener Eintrag</small>}</span><small>{formatQuantity(item.quantity, item.unit)}</small></li>
                      ))}
                    </ul>
                    <div className="shopping-archive-actions">
                      <button className="button button-outline" type="button" disabled={busy} onClick={() => void restoreShoppingList(archived)}>
                        <RotateCcw size={15} /> Wiederherstellen
                      </button>
                      <small>Die Liste wird in ihrer ursprünglichen Woche geöffnet; der Abhakstatus bleibt erhalten.</small>
                    </div>
                  </details>
                ))}
              </section>
            )}
          </div>
        )}

        {view === "pantry" && (
          <PantryPage
            items={pantryItems}
            busy={busy}
            onFindByBarcode={findPantryItemByBarcode}
            onSave={savePantryItem}
            onDelete={deletePantryItem}
          />
        )}
      </main>

      <footer className="app-footer"><span>mampf.</span><span>{memberCount} {memberCount === 1 ? "Mitglied" : "Mitglieder"} <UsersRound size={14} /></span></footer>

      {inviteOpen && role === "owner" && (
        <InviteDialog
          busy={busy}
          onClose={() => setInviteOpen(false)}
          onInvite={async () => {
            setBusy(true);
            setError("");
            try {
              return await inviteMember();
            } catch (reason) {
              setError(errorText(reason));
              throw reason;
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {editorOpen && (
        <div className="modal-backdrop editor-backdrop" role="presentation" onClick={() => setEditorOpen(false)}>
          <div className="editor-modal modal-card" role="presentation" onClick={(event) => event.stopPropagation()}>
            <RecipeEditor
              key={editorRecipe?.id ?? "new"}
              initial={editorRecipe ?? undefined}
              busy={busy}
              error={error}
              onCancel={() => { setEditorOpen(false); setEditorRecipe(null); }}
              onSave={createRecipe}
              onDelete={editorRecipe ? () => deleteRecipe(editorRecipe) : undefined}
            />
          </div>
        </div>
      )}
      {selectedRecipe && (
        <RecipeDetail
          recipe={selectedRecipe}
          currentUserId={session.user.id}
          busy={busy}
          error={error}
          onRate={(rating) => void rateRecipe(selectedRecipe.id, rating)}
          onClose={() => setSelectedRecipe(null)}
          onEdit={() => { setEditorRecipe(selectedRecipe); setEditorOpen(true); setSelectedRecipe(null); }}
          onCook={() => { setCookingRecipe(selectedRecipe); setSelectedRecipe(null); }}
          onDelete={() => void deleteRecipe(selectedRecipe)}
        />
      )}
      {cookingRecipe && <CookingMode recipe={cookingRecipe} onClose={() => setCookingRecipe(null)} />}
    </div>
  );
}
