import "../lib/preact-px";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/components.css";
import "./popup.css";
import { render } from "preact";
import { initTheme } from "../lib/theme";
import { Popup } from "./Popup";

initTheme();
render(<Popup />, document.getElementById("root")!);
