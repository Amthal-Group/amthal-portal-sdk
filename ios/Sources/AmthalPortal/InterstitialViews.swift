import UIKit

/// Loading skeleton: a large activity indicator on the system background,
/// shown from first load until the portal reports `ready`.
final class PortalSkeletonView: UIView {
    private let spinner = UIActivityIndicatorView(style: .large)

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .systemBackground
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.startAnimating()
        addSubview(spinner)
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}

/// Full-screen interstitial used for error states (offline / load failed /
/// version incompatible) and the session-expired waiting overlay.
/// Programmatic UIKit, localized by the caller.
final class PortalStatusView: UIView {
    init(
        title: String,
        message: String,
        retryTitle: String? = nil,
        showsSpinner: Bool = false,
        dimmed: Bool = false,
        isRTL: Bool = false,
        onRetry: (() -> Void)? = nil
    ) {
        super.init(frame: .zero)
        backgroundColor = dimmed
            ? UIColor.systemBackground.withAlphaComponent(0.92)
            : .systemBackground

        let titleLabel = UILabel()
        titleLabel.text = title
        titleLabel.font = .preferredFont(forTextStyle: .title2)
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.textColor = .label
        titleLabel.textAlignment = .center
        titleLabel.numberOfLines = 0

        let messageLabel = UILabel()
        messageLabel.text = message
        messageLabel.font = .preferredFont(forTextStyle: .body)
        messageLabel.adjustsFontForContentSizeCategory = true
        messageLabel.textColor = .secondaryLabel
        messageLabel.textAlignment = .center
        messageLabel.numberOfLines = 0

        var arrangedViews: [UIView] = []

        if showsSpinner {
            let spinner = UIActivityIndicatorView(style: .large)
            spinner.startAnimating()
            arrangedViews.append(spinner)
        }

        arrangedViews.append(titleLabel)
        arrangedViews.append(messageLabel)

        if let retryTitle, let onRetry {
            var buttonConfiguration = UIButton.Configuration.filled()
            buttonConfiguration.title = retryTitle
            buttonConfiguration.buttonSize = .large
            buttonConfiguration.cornerStyle = .medium
            let retryButton = UIButton(
                configuration: buttonConfiguration,
                primaryAction: UIAction { _ in onRetry() }
            )
            arrangedViews.append(retryButton)
        }

        let stack = UIStackView(arrangedSubviews: arrangedViews)
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.setCustomSpacing(8, after: titleLabel)
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.semanticContentAttribute = isRTL ? .forceRightToLeft : .forceLeftToRight
        addSubview(stack)

        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: layoutMarginsGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: layoutMarginsGuide.trailingAnchor, constant: -24),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}
