cask "nanokvm-ai-console" do
  arch arm: "arm64", intel: "x64"

  version "1.0.2"
  sha256 arm:   "6c5b35a5d9e5e4c33af2b1134acffbb2b9007ba72301364087bb487113c84413",
         intel: "c3b463b9a32f20f7b62d4a327aa075cdcd5a9f9aa4ca468571e766e218aba6cf"

  url "https://github.com/blue1st/nanokvm-ai-console/releases/download/v#{version}/NanoKVM-AI-Console-#{version}-mac-#{arch}.dmg"
  name "NanoKVM AI Console"
  desc "Desktop AI Console for NanoKVM Remote MCP and llama.cpp server"
  homepage "https://github.com/blue1st/nanokvm-ai-console"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "NanoKVM AI Console.app"

  postflight_steps do
    run "/usr/bin/xattr", args: ["-cr", "{{appdir}}/NanoKVM AI Console.app"]
    run "/usr/bin/codesign", args: ["--force", "--deep", "--sign", "-", "{{appdir}}/NanoKVM AI Console.app"]
  end

  zap trash: [
    "~/Library/Application Support/nanokvm-ai-console",
    "~/Library/Preferences/com.nanokvm.aiconsole.plist",
    "~/Library/Saved Application State/com.nanokvm.aiconsole.savedState",
  ]
end
