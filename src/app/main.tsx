import "../lib/preact-px";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/components.css";
import "./app.css";
import { render } from "preact";
import { initTheme } from "../lib/theme";
import { App } from "./App";

initTheme();
render(<App />, document.getElementById("root")!);
