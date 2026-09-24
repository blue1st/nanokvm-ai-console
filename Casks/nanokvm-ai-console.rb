cask "nanokvm-ai-console" do
  arch arm: "arm64", intel: "x64"

  version "1.0.0"
  sha256 :no_check # Updated automatically or skipped for self-signed releases

  url "https://github.com/blue1st/nanokvm-ai-console/releases/download/v#{version}/NanoKVM-AI-Console-#{version}-mac-#{arch}.dmg"
  name "NanoKVM AI Console"
  desc "Desktop AI Console for NanoKVM Remote MCP and llama.cpp server"
  homepage "https://github.com/blue1st/nanokvm-ai-console"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "NanoKVM AI Console.app"

  postflight do
    # Remove macOS quarantine attribute to prevent Gatekeeper "unidentified developer" prompt
    system_command "/usr/bin/xattr",
                   args: ["-cr", "#{appdir}/NanoKVM AI Console.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/nanokvm-ai-console",
    "~/Library/Preferences/com.nanokvm.aiconsole.plist",
    "~/Library/Saved Application State/com.nanokvm.aiconsole.savedState",
  ]
end
