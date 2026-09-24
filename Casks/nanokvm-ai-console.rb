cask "nanokvm-ai-console" do
  arch arm: "arm64", intel: "x64"

  version "1.0.3"
  sha256 arm:   "80c9502421f6d37c384c876f954f01ce2c4fe10bc6955e557f4699cbd94bfe85",
         intel: "1d0035a8dc025bdb7f1cff75e99cf78ad5e7d6845a7503d46edd2fe08ab7fae2"

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
