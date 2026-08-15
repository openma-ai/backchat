import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import { Homepage } from "../Homepage";
import { mountWebsite } from "../mount";
import "../styles.css";

mountWebsite(<Homepage locale="zh-CN" />);
